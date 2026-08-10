import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent, UIEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { extractApiError } from '../api/client'
import {
  apiCreateRoom,
  apiGetMessages,
  apiGetRoom,
  apiListRooms,
  apiMarkRead,
  apiGetUnread,
  type ChatRoomItem,
  type ChatRoomDetail,
  type MessageItem,
} from '../api/chat'
import { apiListUsers } from '../api/motorcycles'
import { useAuth } from '../context/AuthContext'
import { tokenStorage } from '../api/client'
import { linkifyText } from '../utils/linkify'
import { notify } from '../utils/notifications'

// WebSocket URL — использует тот же хост что и страница
const WS_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/v1/chat/ws`

// ── Форматирование времени ──────────────────────────────────────

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const isToday =
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear()
  if (isToday) return fmtTime(iso)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday =
    d.getDate() === yesterday.getDate() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getFullYear() === yesterday.getFullYear()
  if (isYesterday) return `Вчера`
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

// ── Компонент ───────────────────────────────────────────────────

type View = 'list' | 'chat' | 'create'

export default function ChatPage() {
  const { user } = useAuth()
  const isAdmin = user?.is_superuser ?? false
  const [view, setView] = useState<View>('list')
  const [searchParams] = useSearchParams()
  const [isMessagesScrolled, setIsMessagesScrolled] = useState(false)

  // Комнаты
  const [rooms, setRooms] = useState<ChatRoomItem[]>([])
  const [loadingRooms, setLoadingRooms] = useState(true)
  const [roomsError, setRoomsError] = useState<string | null>(null)

  // Активная комната
  const [activeRoomId, setActiveRoomId] = useState<number | null>(null)
  const [activeRoom, setActiveRoom] = useState<ChatRoomDetail | null>(null)
  const [messages, setMessages] = useState<MessageItem[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)

  // Unread
  const [unread, setUnread] = useState<Record<number, number>>({})

  // WebSocket
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>()
  const activeRoomIdRef = useRef<number | null>(null)
  let wsRetryCount = 0  // сбрасывается при успешном подключении

  // Создание комнаты
  const [allUsers, setAllUsers] = useState<{ id: number; username: string }[]>([])
  const [newRoomName, setNewRoomName] = useState('')
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([])
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Отправка сообщения
  const [draft, setDraft] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const draftInputRef = useRef<HTMLTextAreaElement>(null)
  const conversationHeadRef = useRef<HTMLElement>(null)
  const lastMessagesScrollTopRef = useRef(0)
  const isAutoScrollingToHeaderRef = useRef(false)
  const hideHeaderToggleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── WebSocket подключение ─────────────────────────────────────

  const connectWs = useCallback(() => {
    // Всегда берём свежий токен из localStorage
    const accessToken = tokenStorage.getAccess()
    if (!accessToken) {
      console.warn('No access token, skipping WS connect')
      return
    }

    // Exponential backoff: не больше 5 попыток за 30 секунд
    wsRetryCount += 1
    if (wsRetryCount > 5) {
      console.warn('WS: too many reconnect attempts, giving up for 30s')
      reconnectTimer.current = setTimeout(() => {
        wsRetryCount = 0
        connectWs()
      }, 30000)
      return
    }
    const delay = Math.min(1000 * Math.pow(2, wsRetryCount - 1), 16000)
    console.log('WS: connecting in', delay, 'ms')

    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      wsRetryCount = 0  // сброс при успехе
      ws.send(JSON.stringify({ token: accessToken }))
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)

        if (data.type === 'error' && data.error === 'Unauthorized') {
          // Токен истёк — закрываем без автопереподключения
          ws.close(4001)
          return
        }

        if (data.type === 'message') {
          const msg = data.message as MessageItem
          const isOwnMessage = msg.sender_id === user?.id
          setMessages((prev) => {
            // Replace optimistic message (negative id) with real one
            const filtered = prev.filter((m) => m.id >= 0 || m.content !== msg.content)
            if (filtered.some((m) => m.id === msg.id)) return prev
            return [...filtered, msg]
          })
          // Если это входящее сообщение не в активной комнате — увеличить unread + уведомление
          if (!isOwnMessage && msg.room_id !== activeRoomIdRef.current) {
            setUnread((prev) => ({
              ...prev,
              [msg.room_id]: (prev[msg.room_id] || 0) + 1,
            }))
            // Показать нативное уведомление о новом сообщении
            const sender = msg.sender_username || 'Кто-то'
            const preview = (msg.content || '').slice(0, 120)
            notify(`💬 ${sender}`, {
              body: preview,
              tag: `chat-room-${msg.room_id}`,
              data: { url: `/chat?room=${msg.room_id}` },
              channelId: 'chat',
            })
          }
        }
      } catch { /* ignore */ }
    }

    ws.onclose = (event) => {
      // Не переподключаться если была ошибка авторизации
      if (event.code === 4001) {
        console.warn('WS auth failed (expired token), not reconnecting')
        return
      }
      console.log('Chat WS disconnected, reconnecting in 3s...')
      reconnectTimer.current = setTimeout(connectWs, 3000)
    }
    ws.onerror = () => ws.close()
  }, [user?.id])  // activeRoomId берём из ref, user нужен для фильтрации своих сообщений

  useEffect(() => {
    connectWs()
    apiListRooms()
      .then(setRooms)
      .catch((e) => setRoomsError(extractApiError(e)))
      .finally(() => setLoadingRooms(false))

    apiGetUnread()
      .then((u) => setUnread(u.rooms))
      .catch(() => {})

    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connectWs])

  // ── Навигация ─────────────────────────────────────────────────

  const openRoom = useCallback(async (roomId: number) => {
    setView('chat')
    setActiveRoomId(roomId)
    activeRoomIdRef.current = roomId
    setActiveRoom(null)
    setLoadingMessages(true)

    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'join', room_id: roomId }))
    }

    try {
      const [room, msgs] = await Promise.all([
        apiGetRoom(roomId),
        apiGetMessages(roomId),
      ])
      setActiveRoom(room)
      setMessages(msgs)
      // Отметить прочитанным
      if (msgs.length > 0) {
        const last = msgs[msgs.length - 1]
        await apiMarkRead(roomId, last.id)
        setUnread((prev) => {
          const next = { ...prev }
          delete next[roomId]
          return next
        })
      }
    } catch {
      // ignore
    } finally {
      setLoadingMessages(false)
      // Прокрутить вниз
      setTimeout(() => messagesEndRef.current?.scrollIntoView(), 50)
    }
  }, [])

  const backToList = useCallback(() => {
    setView('list')
    if (activeRoomId) {
      wsRef.current?.send(
        JSON.stringify({ type: 'leave', room_id: activeRoomId })
      )
    }
    setActiveRoomId(null)
    activeRoomIdRef.current = null
    setActiveRoom(null)
    setMessages([])
    // Перезагрузить список комнат
    apiListRooms().then(setRooms).catch(() => {})
    apiGetUnread().then((u) => setUnread(u.rooms)).catch(() => {})
  }, [activeRoomId])

  // Если перешли по ?room=123 — сразу открыть эту комнату
  useEffect(() => {
    const roomIdParam = searchParams.get('room')
    if (roomIdParam) {
      const rid = parseInt(roomIdParam, 10)
      if (!isNaN(rid)) {
        openRoom(rid)
      }
    }
  }, [searchParams, openRoom])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return

    lastMessagesScrollTopRef.current = container.scrollTop
    setIsMessagesScrolled(false)
  }, [view, activeRoomId, messages.length])

  useEffect(() => {
    return () => {
      if (hideHeaderToggleTimerRef.current) {
        clearTimeout(hideHeaderToggleTimerRef.current)
      }
    }
  }, [])

  const handleMessagesScroll = useCallback((e: UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget
    const currentScrollTop = container.scrollTop
    const distanceToBottom =
      container.scrollHeight - container.clientHeight - currentScrollTop
    const isNearBottom = distanceToBottom <= 24

    if (hideHeaderToggleTimerRef.current) {
      clearTimeout(hideHeaderToggleTimerRef.current)
      hideHeaderToggleTimerRef.current = null
    }

    if (isAutoScrollingToHeaderRef.current) {
      setIsMessagesScrolled(false)
      lastMessagesScrollTopRef.current = currentScrollTop

      if (currentScrollTop <= 24) {
        isAutoScrollingToHeaderRef.current = false
      }
      return
    }

    const isScrollingUp = currentScrollTop < lastMessagesScrollTopRef.current
    const shouldShow = isScrollingUp && currentScrollTop > 24 && !isNearBottom

    setIsMessagesScrolled(shouldShow)
    lastMessagesScrollTopRef.current = currentScrollTop

    if (shouldShow) {
      hideHeaderToggleTimerRef.current = setTimeout(() => {
        setIsMessagesScrolled(false)
      }, 1200)
    }
  }, [])

  const scrollToConversationHeader = useCallback(() => {
    if (hideHeaderToggleTimerRef.current) {
      clearTimeout(hideHeaderToggleTimerRef.current)
      hideHeaderToggleTimerRef.current = null
    }
    isAutoScrollingToHeaderRef.current = true
    setIsMessagesScrolled(false)
    conversationHeadRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })
    window.setTimeout(() => {
      isAutoScrollingToHeaderRef.current = false
    }, 1000)
  }, [])

  // ── Отправка сообщения ────────────────────────────────────────

  const sendMessage = useCallback((e?: FormEvent) => {
    e?.preventDefault()
    const text = draft.trim()
    if (!text || !activeRoomId) return

    const keepComposerVisible = () => {
      requestAnimationFrame(() => {
        draftInputRef.current?.focus({ preventScroll: true })
        draftInputRef.current?.scrollIntoView({ block: 'nearest' })
        messagesEndRef.current?.scrollIntoView({ block: 'end' })
      })
    }

    // Optimistic: add message to list immediately
    const optimisticId = -Date.now()
    const optimisticMsg: MessageItem = {
      id: optimisticId,
      room_id: activeRoomId,
      sender_id: user?.id ?? null,
      content: text,
      message_type: 'text',
      image_url: null,
      is_deleted: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      sender_username: user?.username ?? null,
      sender_avatar_url: user?.avatar_url ?? null,
      sender_sponsor_badge: user?.sponsor_badge ?? null,
    }
    setMessages((prev) => [...prev, optimisticMsg])
    setDraft('')
    keepComposerVisible()

    const ws = wsRef.current
    if (!ws) {
      console.warn('WebSocket not connected')
      // Remove optimistic on failure
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId))
      return
    }
    if (ws.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket not open, state:', ws.readyState)
      // Ждём открытия и пробуем снова
      const onOpen = () => {
        ws.removeEventListener('open', onOpen)
        ws.send(JSON.stringify({
          type: 'message',
          room_id: activeRoomId,
          content: text,
          message_type: 'text',
        }))
      }
      ws.addEventListener('open', onOpen)
      return
    }
    ws.send(JSON.stringify({
      type: 'message',
      room_id: activeRoomId,
      content: text,
      message_type: 'text',
    }))

    // When real message arrives from WS, replace optimistic
    // Also poll via REST API as fallback in case WS delivery fails
    const checkReplaced = setTimeout(async () => {
      setMessages((prev) => {
        const optimistic = prev.find((m) => m.id === optimisticId)
        if (!optimistic) return prev
        // Mark as sending... (still waiting)
        return prev
      })
      // Try REST API fallback after 8s
      setTimeout(async () => {
        try {
          const latest = await apiGetMessages(activeRoomId, undefined, 10)
          setMessages((prev) => {
            // Replace optimistic if we find a matching real message
            const hasMatch = latest.some(
              (m) => m.content === text && m.sender_id === (user?.id ?? null)
            )
            if (hasMatch) {
              return prev.filter((m) => m.id !== optimisticId)
            }
            // Still not delivered — mark as failed
            return prev.map((m) =>
              m.id === optimisticId
                ? { ...m, is_deleted: true, content: '(не отправлено) ' + text }
                : m
            )
          })
        } catch {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === optimisticId
                ? { ...m, is_deleted: true, content: '(не отправлено) ' + text }
                : m
            )
          )
        }
      }, 8000)
    }, 5000)

    return () => clearTimeout(checkReplaced)
  }, [draft, activeRoomId, user])

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
    // typing
    if (activeRoomId && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'typing', room_id: activeRoomId }))
    }
  }, [sendMessage, activeRoomId])

  // ── Создание комнаты ──────────────────────────────────────────

  const openCreate = useCallback(async () => {
    setView('create')
    setCreateError(null)
    setNewRoomName('')
    setSelectedUserIds([])
    try {
      const users = await apiListUsers()
      setAllUsers(users.map((u: any) => ({ id: u.id, username: u.username })))
    } catch { /* ignore */ }
  }, [])

  const createRoom = useCallback(async (e: FormEvent) => {
    e.preventDefault()
    if (selectedUserIds.length === 0) return
    setCreating(true)
    setCreateError(null)
    try {
      const room = await apiCreateRoom({
        name: newRoomName || null,
        room_type: 'group',
        member_ids: selectedUserIds,
      })
      setView('list')
      setRooms((prev) => [room as any, ...prev])
    } catch (err) {
      setCreateError(extractApiError(err))
    } finally {
      setCreating(false)
    }
  }, [newRoomName, selectedUserIds])

  const toggleUser = useCallback((uid: number) => {
    setSelectedUserIds((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]
    )
  }, [])

  // ── Рендер: список комнат ─────────────────────────────────────

  const roomName = (room: ChatRoomItem) => {
    if (room.name) return room.name
    if (room.room_type === 'dm' && room.dm_partner_name) {
      return room.dm_partner_name
    }
    return room.room_type === 'dm' ? 'Личный чат' : `Беседа #${room.id}`
  }

  const conversationTitle = (room: ChatRoomDetail | null, roomId: number | null) => {
    if (!room || !roomId) return 'Загрузка…'
    if (room.name) return room.name
    if (room.room_type === 'dm') {
      const partner = room.members?.find((m) => m.user_id !== user?.id)
      if (partner?.username) return partner.username
      return 'Личный чат'
    }
    return `Беседа #${roomId}`
  }

  const totalUnread = useMemo(
    () => Object.values(unread).reduce((a, b) => a + b, 0),
    [unread],
  )

  return (
    <section className="chat-page">
      {/* ── Список комнат ──────────────────────────────────── */}
      {view === 'list' && (
        <>
          <header className="chat-page__head">
            <div>
              <h1 className="calendar-page__title">💬 Байкчат</h1>
              <p className="muted">Общайся с райдерами в реальном времени</p>
            </div>
            {totalUnread > 0 && (
              <span className="chat-badge">{totalUnread}</span>
            )}
          </header>

          <div className="chat-actions">
            {isAdmin && (
              <button type="button" className="btn btn-primary" onClick={openCreate}>
                + Новая беседа
              </button>
            )}
          </div>

          {roomsError && <div className="alert alert-error">{roomsError}</div>}

          {loadingRooms ? (
            <div className="muted">Загрузка…</div>
          ) : rooms.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state__icon">💬</div>
              <p className="muted">У вас пока нет чатов. Создайте первый!</p>
            </div>
          ) : (
            <ul className="chat-room-list">
              {rooms.map((room) => (
                <li key={room.id} className="chat-room-item">
                  <button
                    type="button"
                    className="chat-room-btn"
                    onClick={() => openRoom(room.id)}
                  >
                    <div className="chat-room-avatar">
                      {room.room_type === 'dm' ? '👤' : '👥'}
                    </div>
                    <div className="chat-room-body">
                      <div className="chat-room-top">
                        <span className="chat-room-name">{roomName(room)}</span>
                        {room.last_message && (
                          <span className="chat-room-time">
                            {fmtDate(room.last_message.created_at)}
                          </span>
                        )}
                      </div>
                      <div className="chat-room-bottom">
                        <span className="chat-room-preview">
                          {room.last_message
                            ? room.last_message.content?.slice(0, 80) || '📷 Фото'
                            : 'Нет сообщений'}
                        </span>
                        {unread[room.id] > 0 && (
                          <span className="chat-room-unread">
                            {unread[room.id]}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* ── Чат (активная комната) ─────────────────────────── */}
      {view === 'chat' && activeRoomId && (
        <div className="chat-conversation">
          <header className="chat-conversation__head" ref={conversationHeadRef}>
            <button
              type="button"
              className="btn btn-ghost chat-conversation__back-btn"
              onClick={backToList}
            >
              ← Чаты
            </button>
            <h2 className="chat-conversation__title">
              {conversationTitle(activeRoom, activeRoomId)}
            </h2>
            <span className="chat-conversation__members">
              {activeRoom?.member_count ?? 0} участ.
            </span>
          </header>

          <div className="chat-messages" ref={messagesContainerRef} onScroll={handleMessagesScroll}>
            {loadingMessages ? (
              <div className="muted" style={{ padding: 16 }}>Загрузка сообщений…</div>
            ) : messages.length === 0 ? (
              <div className="empty-state" style={{ padding: 32 }}>
                <div className="empty-state__icon">💬</div>
                <p className="muted">Пока нет сообщений. Напишите первое!</p>
              </div>
            ) : (
              messages.map((msg, i) => {
                const prev = messages[i - 1]
                const showHeader =
                  !prev ||
                  prev.sender_id !== msg.sender_id ||
                  new Date(msg.created_at).getTime() -
                    new Date(prev.created_at).getTime() >
                    300000 // 5 минут
                return (
                  <div
                    key={msg.id}
                    className={`chat-msg ${showHeader ? 'has-header' : 'same-sender'} ${
                      msg.sender_id === user?.id ? 'chat-msg--mine' : 'chat-msg--other'
                    }`}
                  >
                    {showHeader && (
                      <div className="chat-msg__header">
                        <span className="chat-msg__sender">
                          {msg.sender_username || '?'}
                          {msg.sender_sponsor_badge && (
                            <span> {msg.sender_sponsor_badge}</span>
                          )}
                        </span>
                        <span className="chat-msg__time">{fmtTime(msg.created_at)}</span>
                      </div>
                    )}
                    <div className="chat-msg__bubble">
                      {msg.message_type === 'image' && msg.image_url ? (
                        <img src={msg.image_url} alt="" className="chat-msg__img" />
                      ) : msg.content ? (
                        <p>{linkifyText(msg.content)}</p>
                      ) : null}
                      {msg.is_deleted && (
                        <em className="muted">Сообщение удалено</em>
                      )}
                    </div>
                  </div>
                )
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {isMessagesScrolled && (
            <div className="chat-conversation__header-toggle-wrap">
              <button
                type="button"
                className="chat-conversation__header-toggle"
                onClick={scrollToConversationHeader}
                aria-label="Показать шапку чата"
                title="Показать шапку чата"
              >
                ↑
              </button>
            </div>
          )}

          <form className="chat-input" onSubmit={sendMessage}>
            <textarea
              ref={draftInputRef}
              className="chat-input__textarea"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Сообщение…"
              rows={1}
              autoFocus
            />
            <button
              type="submit"
              className="btn btn-primary chat-input__send"
              onMouseDown={(e) => e.preventDefault()}
              onTouchStart={(e) => e.preventDefault()}
              disabled={!draft.trim()}
            >
              →
            </button>
          </form>
        </div>
      )}

      {/* ── Создание комнаты ───────────────────────────────── */}
      {view === 'create' && (
        <div className="chat-create">
          <header className="chat-conversation__head">
            <button type="button" className="btn-ghost" onClick={() => setView('list')}>
              ← Назад
            </button>
            <h2 className="chat-conversation__title">Новая беседа</h2>
          </header>

          {createError && <div className="alert alert-error">{createError}</div>}

          <form onSubmit={createRoom} className="chat-create__form">
            <div className="form-group">
              <label className="form-label">Название чата</label>
              <input
                type="text"
                className="form-input"
                value={newRoomName}
                onChange={(e) => setNewRoomName(e.target.value)}
                placeholder="Например: Выезд на карьер"
                maxLength={255}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Выберите участников</label>
              {allUsers.length === 0 ? (
                <p className="muted">Загрузка пользователей…</p>
              ) : (
                <div className="chat-user-picker">
                  {allUsers.map((u) => (
                    <label key={u.id} className="chat-user-chip">
                      <input
                        type="checkbox"
                        checked={selectedUserIds.includes(u.id)}
                        onChange={() => toggleUser(u.id)}
                      />
                      <span>{u.username}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={creating || selectedUserIds.length === 0}
            >
              {creating ? 'Создаю…' : 'Создать чат'}
            </button>
          </form>
        </div>
      )}
    </section>
  )
}
