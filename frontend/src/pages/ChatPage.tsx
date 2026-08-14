import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent, PointerEvent, TouchEvent, UIEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { extractApiError } from '../api/client'
import {
  apiAddMembers,
  apiCreateRoom,
  apiGetMessages,
  apiGetRoom,
  apiListRooms,
  apiMarkRead,
  apiRemoveMembers,
  apiGetUnread,
  apiUpdateRoomNotifications,
  type ChatRoomItem,
  type ChatMemberItem,
  type ChatRoomDetail,
  type MessageItem,
  type MessageReactionItem,
  type ReplyMessageItem,
} from '../api/chat'
import { apiListUsers, type PublicUser } from '../api/motorcycles'
import { useAuth } from '../context/AuthContext'
import { tokenStorage } from '../api/client'
import { linkifyText } from '../utils/linkify'
import { notify } from '../utils/notifications'

// WebSocket URL — использует тот же хост что и страница
const WS_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/v1/chat/ws`
const QUICK_REACTIONS = ['👍', '❤️', '🔥', '😂', '👏', '😮']

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

function replyPreviewText(message: Pick<ReplyMessageItem, 'message_type' | 'content' | 'image_url' | 'is_deleted'>): string {
  if (message.is_deleted) return 'Сообщение удалено'
  if (message.message_type === 'image' && message.image_url) return '📷 Фото'
  return message.content?.trim() || 'Сообщение'
}

function toReplyMessageItem(message: MessageItem): ReplyMessageItem {
  return {
    id: message.id,
    sender_id: message.sender_id,
    sender_full_name: message.sender_full_name,
    sender_username: message.sender_username,
    content: message.content,
    message_type: message.message_type,
    image_url: message.image_url,
    is_deleted: message.is_deleted,
  }
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
  const [memberActionError, setMemberActionError] = useState<string | null>(null)
  const [memberActionSuccess, setMemberActionSuccess] = useState<string | null>(null)
  const [memberActionBusyId, setMemberActionBusyId] = useState<number | null>(null)
  const [showRoomSettings, setShowRoomSettings] = useState(false)

  // Unread
  const [unread, setUnread] = useState<Record<number, number>>({})

  // WebSocket
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>()
  const activeRoomIdRef = useRef<number | null>(null)
  const roomsRef = useRef<ChatRoomItem[]>([])
  let wsRetryCount = 0  // сбрасывается при успешном подключении

  // Создание комнаты
  const [allUsers, setAllUsers] = useState<PublicUser[]>([])
  const [newRoomName, setNewRoomName] = useState('')
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([])
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Отправка сообщения
  const [draft, setDraft] = useState('')
  const [replyToMessage, setReplyToMessage] = useState<MessageItem | null>(null)
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<number | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const reactionLongPressTimerRef = useRef<number | null>(null)
  const reactionLongPressTriggeredRef = useRef(false)
  const draftInputRef = useRef<HTMLTextAreaElement>(null)
  const conversationHeadRef = useRef<HTMLElement>(null)
  const lastMessagesScrollTopRef = useRef(0)
  const isAutoScrollingToHeaderRef = useRef(false)
  const hideHeaderToggleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastTouchYRef = useRef<number | null>(null)

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
            const targetRoom = roomsRef.current.find((room) => room.id === msg.room_id)
            if (targetRoom?.notifications_enabled !== false) {
              // Показать нативное уведомление о новом сообщении
              const sender = msg.sender_full_name || msg.sender_username || 'Кто-то'
              const preview = (msg.content || '').slice(0, 120)
              notify(`💬 ${sender}`, {
                body: preview,
                tag: `chat-room-${msg.room_id}`,
                data: { url: `/chat?room=${msg.room_id}` },
                channelId: 'chat',
              })
            }
          }
        } else if (data.type === 'reaction') {
          const message = data.message as MessageItem | undefined
          const messageId = data.message_id as number | undefined
          if (!message || !messageId) return

          setMessages((prev) =>
            prev.map((item) => (item.id === messageId ? { ...item, reactions: message.reactions } : item)),
          )
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
    const root = document.documentElement

    const updateAppVh = () => {
      root.style.setProperty('--app-vh', `${window.innerHeight * 0.01}px`)
    }

    updateAppVh()
    window.addEventListener('resize', updateAppVh)
    window.addEventListener('orientationchange', updateAppVh)

    return () => {
      window.removeEventListener('resize', updateAppVh)
      window.removeEventListener('orientationchange', updateAppVh)
      root.style.removeProperty('--app-vh')
    }
  }, [])

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

  useEffect(() => {
    roomsRef.current = rooms
  }, [rooms])

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
      setMemberActionError(null)
      setMemberActionSuccess(null)
      setShowRoomSettings(false)
      setRooms((prev) => prev.map((item) => (item.id === roomId ? { ...item, ...room } : item)))
      setReplyToMessage(null)
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
    setShowRoomSettings(false)
    setMessages([])
    setReplyToMessage(null)
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
      if (reactionLongPressTimerRef.current !== null) {
        window.clearTimeout(reactionLongPressTimerRef.current)
      }
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

  const showHeaderToggleTemporarily = useCallback((container: HTMLDivElement) => {
    const currentScrollTop = container.scrollTop
    const distanceToBottom =
      container.scrollHeight - container.clientHeight - currentScrollTop
    const isNearBottom = distanceToBottom <= 24

    if (isAutoScrollingToHeaderRef.current) return
    if (currentScrollTop <= 24 || isNearBottom) return

    if (hideHeaderToggleTimerRef.current) {
      clearTimeout(hideHeaderToggleTimerRef.current)
      hideHeaderToggleTimerRef.current = null
    }

    setIsMessagesScrolled(true)
    hideHeaderToggleTimerRef.current = setTimeout(() => {
      setIsMessagesScrolled(false)
    }, 1200)
  }, [])

  const handleMessagesTouchStart = useCallback((e: TouchEvent<HTMLDivElement>) => {
    lastTouchYRef.current = e.touches[0]?.clientY ?? null
  }, [])

  const handleMessagesTouchMove = useCallback((e: TouchEvent<HTMLDivElement>) => {
    const currentTouchY = e.touches[0]?.clientY
    const lastTouchY = lastTouchYRef.current

    if (currentTouchY == null || lastTouchY == null) return

    if (currentTouchY > lastTouchY + 6) {
      showHeaderToggleTemporarily(e.currentTarget)
    }

    lastTouchYRef.current = currentTouchY
  }, [showHeaderToggleTemporarily])

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
      sender_full_name: user?.full_name ?? null,
      sender_username: user?.username ?? null,
      sender_avatar_url: user?.avatar_url ?? null,
      sender_sponsor_badge: user?.sponsor_badge ?? null,
      reply_to: replyToMessage ? toReplyMessageItem(replyToMessage) : null,
      reactions: [],
    }
    setMessages((prev) => [...prev, optimisticMsg])
    setDraft('')
    const replyTargetId = replyToMessage?.id ?? null
    setReplyToMessage(null)
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
          reply_to_message_id: replyTargetId,
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
      reply_to_message_id: replyTargetId,
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
  }, [draft, activeRoomId, replyToMessage, user])

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
      setAllUsers(users)
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
      setRooms((prev) => [room, ...prev])
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

  const activeRoomMuted = activeRoom?.notifications_enabled === false
  const currentRoomMember = activeRoom?.members.find((member) => member.user_id === user?.id) ?? null
  const canManageMembers =
    activeRoom?.room_type === 'group' &&
    (currentRoomMember?.role === 'admin' || Boolean(user?.is_superuser))
  const sortedRoomMembers = useMemo(
    () => [...(activeRoom?.members ?? [])].sort((a, b) => (a.username ?? '').localeCompare(b.username ?? '', 'ru')),
    [activeRoom],
  )
  const availableUsersForActiveRoom = useMemo(() => {
    const memberIds = new Set((activeRoom?.members ?? []).map((member) => member.user_id))
    return allUsers
      .filter((candidate) => !memberIds.has(candidate.id))
      .sort((a, b) => a.username.localeCompare(b.username, 'ru'))
  }, [activeRoom, allUsers])

  const refreshActiveRoom = useCallback(async (roomId: number) => {
    const room = await apiGetRoom(roomId)
    setActiveRoom(room)
    setRooms((prev) => prev.map((item) => (item.id === roomId ? { ...item, ...room } : item)))
  }, [])

  const ensureUsersLoaded = useCallback(async () => {
    if (allUsers.length > 0) return
    const users = await apiListUsers()
    setAllUsers(users)
  }, [allUsers.length])

  const toggleRoomNotifications = useCallback(async (roomId: number) => {
    const currentEnabled = activeRoom?.notifications_enabled ?? true
    const nextEnabled = !currentEnabled

    setRooms((prev) =>
      prev.map((room) =>
        room.id === roomId ? { ...room, notifications_enabled: nextEnabled } : room,
      ),
    )
    setActiveRoom((prev) => (
      prev && prev.id === roomId
        ? { ...prev, notifications_enabled: nextEnabled }
        : prev
    ))

    try {
      const updatedRoom = await apiUpdateRoomNotifications(roomId, nextEnabled)
      setRooms((prev) => prev.map((room) => (room.id === roomId ? { ...room, ...updatedRoom } : room)))
      setActiveRoom((prev) => (
        prev && prev.id === roomId
          ? { ...prev, notifications_enabled: updatedRoom.notifications_enabled }
          : prev
      ))
    } catch {
      setRooms((prev) =>
        prev.map((room) =>
          room.id === roomId ? { ...room, notifications_enabled: currentEnabled } : room,
        ),
      )
      setActiveRoom((prev) => (
        prev && prev.id === roomId
          ? { ...prev, notifications_enabled: currentEnabled }
          : prev
      ))
    }
  }, [activeRoom])

  const addMemberToActiveRoom = useCallback(async (userId: number) => {
    if (!activeRoomId) return
    setMemberActionError(null)
    setMemberActionSuccess(null)
    setMemberActionBusyId(userId)
    try {
      await apiAddMembers(activeRoomId, [userId])
      await refreshActiveRoom(activeRoomId)
      const addedUser = allUsers.find((candidate) => candidate.id === userId)
      setMemberActionSuccess(
        addedUser?.username ? `@${addedUser.username} добавлен(а) в чат` : 'Пользователь добавлен в чат',
      )
    } catch (err) {
      setMemberActionError(extractApiError(err))
    } finally {
      setMemberActionBusyId(null)
    }
  }, [activeRoomId, allUsers, refreshActiveRoom])

  const removeMemberFromActiveRoom = useCallback(async (member: ChatMemberItem) => {
    if (!activeRoomId) return
    setMemberActionError(null)
    setMemberActionSuccess(null)
    setMemberActionBusyId(member.user_id)
    try {
      await apiRemoveMembers(activeRoomId, [member.user_id])
      await refreshActiveRoom(activeRoomId)
      setMemberActionSuccess(
        member.username ? `@${member.username} удалён(а) из чата` : 'Пользователь удалён из чата',
      )
    } catch (err) {
      setMemberActionError(extractApiError(err))
    } finally {
      setMemberActionBusyId(null)
    }
  }, [activeRoomId, refreshActiveRoom])

  const startReply = useCallback((message: MessageItem) => {
    setReplyToMessage(message)
    draftInputRef.current?.focus()
  }, [])

  const cancelReply = useCallback(() => {
    setReplyToMessage(null)
  }, [])

  const clearReactionLongPress = useCallback(() => {
    if (reactionLongPressTimerRef.current !== null) {
      window.clearTimeout(reactionLongPressTimerRef.current)
      reactionLongPressTimerRef.current = null
    }
  }, [])

  const startReactionLongPress = useCallback((messageId: number) => {
    clearReactionLongPress()
    reactionLongPressTriggeredRef.current = false
    reactionLongPressTimerRef.current = window.setTimeout(() => {
      reactionLongPressTriggeredRef.current = true
      setReactionPickerMessageId(messageId)
      reactionLongPressTimerRef.current = null
    }, 450)
  }, [clearReactionLongPress])

  const cancelReactionLongPress = useCallback(() => {
    clearReactionLongPress()
  }, [clearReactionLongPress])

  const toggleReactionPicker = useCallback((messageId: number) => {
    setReactionPickerMessageId((prev) => (prev === messageId ? null : messageId))
  }, [])

  const openReactionPicker = useCallback((messageId: number) => {
    setReactionPickerMessageId(messageId)
  }, [])

  const swallowClickAfterLongPress = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!reactionLongPressTriggeredRef.current) return
    event.preventDefault()
    event.stopPropagation()
    reactionLongPressTriggeredRef.current = false
  }, [])

  const toggleReaction = useCallback((messageId: number, emoji: string) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN || !activeRoomId) return
    wsRef.current.send(JSON.stringify({
      type: 'reaction',
      room_id: activeRoomId,
      message_id: messageId,
      emoji,
    }))
    setReactionPickerMessageId(null)
  }, [activeRoomId])

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
                        {room.notifications_enabled === false && (
                          <span className="chat-room-muted-badge">Без звука</span>
                        )}
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
            {canManageMembers && (
              <button
                type="button"
                className={`btn btn-ghost btn-sm chat-settings-toggle ${showRoomSettings ? 'is-active' : ''}`}
                onClick={async () => {
                  const next = !showRoomSettings
                  if (next) {
                    try {
                      await ensureUsersLoaded()
                    } catch (err) {
                      setMemberActionError(extractApiError(err))
                    }
                  }
                  setShowRoomSettings(next)
                }}
              >
                ⚙️ Настройки
              </button>
            )}
            <button
              type="button"
              className={`btn btn-ghost btn-sm chat-notification-toggle ${
                activeRoomMuted ? 'chat-notification-toggle--muted' : 'chat-notification-toggle--enabled'
              }`}
              onClick={() => toggleRoomNotifications(activeRoomId)}
              aria-pressed={activeRoomMuted}
              title={
                activeRoomMuted
                  ? 'Включить уведомления для этого чата'
                  : 'Отключить уведомления для этого чата'
              }
            >
              {activeRoomMuted ? '🔕 Выкл.' : '🔔 Вкл.'}
            </button>
          </header>

          {canManageMembers && showRoomSettings && (
            <div className="chat-members-panel edit-card">
              <h3 className="garage__form-title">Настройки чата</h3>
              <p className="muted">
                Здесь можно управлять составом участников и вручную добавлять пользователей в этот чат.
              </p>

              {memberActionError && <div className="alert alert-error">{memberActionError}</div>}
              {memberActionSuccess && <div className="alert alert-success">{memberActionSuccess}</div>}

              <div className="grid-2">
                <div>
                  <h4 className="chat-members-panel__subtitle">
                    В чате: {sortedRoomMembers.length}
                  </h4>
                  {sortedRoomMembers.length === 0 ? (
                    <div className="muted">Участников пока нет.</div>
                  ) : (
                    <div className="events-table-wrap chat-members-panel__table-wrap">
                      <table className="events-table chat-members-panel__table">
                        <thead>
                          <tr>
                            <th>Пользователь</th>
                            <th>Роль</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedRoomMembers.map((member) => (
                            <tr key={member.id}>
                              <td>
                                <strong>@{member.username ?? `id:${member.user_id}`}</strong>
                              </td>
                              <td>
                                {member.role === 'admin' ? (
                                  <span className="badge badge-accent">админ</span>
                                ) : (
                                  <span className="badge">участник</span>
                                )}
                              </td>
                              <td className="events-table__actions">
                                {member.role === 'admin' ? (
                                  <span className="muted">—</span>
                                ) : (
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-sm btn-danger"
                                    onClick={() => removeMemberFromActiveRoom(member)}
                                    disabled={memberActionBusyId === member.user_id}
                                  >
                                    Удалить
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div>
                  <h4 className="chat-members-panel__subtitle">Добавить в чат</h4>
                  {availableUsersForActiveRoom.length === 0 ? (
                    <div className="muted">Все пользователи уже состоят в этом чате.</div>
                  ) : (
                    <div className="events-table-wrap chat-members-panel__table-wrap">
                      <table className="events-table chat-members-panel__table">
                        <thead>
                          <tr>
                            <th>Пользователь</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {availableUsersForActiveRoom.map((candidate) => (
                            <tr key={candidate.id}>
                              <td>
                                <strong>@{candidate.username}</strong>
                              </td>
                              <td className="events-table__actions">
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => addMemberToActiveRoom(candidate.id)}
                                  disabled={memberActionBusyId === candidate.id}
                                >
                                  Добавить
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div
            className="chat-messages"
            ref={messagesContainerRef}
            onScroll={handleMessagesScroll}
            onTouchStart={handleMessagesTouchStart}
            onTouchMove={handleMessagesTouchMove}
          >
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
                          {msg.sender_full_name || msg.sender_username || '?'}
                          {msg.sender_sponsor_badge && (
                            <span> {msg.sender_sponsor_badge}</span>
                          )}
                        </span>
                        <span className="chat-msg__time">{fmtTime(msg.created_at)}</span>
                        <button
                          type="button"
                          className="chat-msg__reply-btn"
                          onClick={() => startReply(msg)}
                        >
                          Ответить
                        </button>
                      </div>
                    )}
                    <div
                      className="chat-msg__bubble"
                      onPointerDown={(event) => {
                        if (event.pointerType === 'mouse') return
                        startReactionLongPress(msg.id)
                      }}
                      onPointerUp={cancelReactionLongPress}
                      onPointerCancel={cancelReactionLongPress}
                      onPointerLeave={cancelReactionLongPress}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        if (reactionLongPressTriggeredRef.current) {
                          return
                        }
                        openReactionPicker(msg.id)
                      }}
                      onClick={(event) => {
                        if (!event.altKey) return
                        event.preventDefault()
                        toggleReactionPicker(msg.id)
                      }}
                      onClickCapture={swallowClickAfterLongPress}
                    >
                      {msg.reply_to && (
                        <button
                          type="button"
                          className="chat-msg__reply-preview"
                          onClick={() => {
                            const replyTo = msg.reply_to
                            if (!replyTo) return

                            const replySource: MessageItem = {
                              id: replyTo.id,
                              room_id: msg.room_id,
                              sender_id: replyTo.sender_id,
                              content: replyTo.content,
                              message_type: replyTo.message_type,
                              image_url: replyTo.image_url,
                              is_deleted: replyTo.is_deleted,
                              created_at: msg.created_at,
                              updated_at: msg.created_at,
                              sender_full_name: replyTo.sender_full_name,
                              sender_username: replyTo.sender_username,
                              sender_avatar_url: null,
                              sender_sponsor_badge: null,
                              reply_to: null,
                              reactions: [],
                            }
                            startReply(replySource)
                          }}
                        >
                          <span className="chat-msg__reply-label">Ответ на сообщение</span>
                          <span className="chat-msg__reply-author">
                            {msg.reply_to.sender_full_name || msg.reply_to.sender_username || 'Пользователь'}
                          </span>
                          <span className="chat-msg__reply-text">
                            {replyPreviewText(msg.reply_to)}
                          </span>
                        </button>
                      )}
                      {msg.message_type === 'image' && msg.image_url ? (
                        <img src={msg.image_url} alt="" className="chat-msg__img" />
                      ) : msg.content ? (
                        <p>{linkifyText(msg.content)}</p>
                      ) : null}
                      {msg.is_deleted && (
                        <em className="muted">Сообщение удалено</em>
                      )}
                      {reactionPickerMessageId === msg.id && (
                        <div className="chat-msg__reaction-picker">
                          {QUICK_REACTIONS.map((emoji) => (
                            <button
                              key={emoji}
                              type="button"
                              className="chat-msg__reaction-option"
                              onClick={() => toggleReaction(msg.id, emoji)}
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      )}
                      {msg.reactions.length > 0 && (
                        <div className="chat-msg__reactions">
                          {msg.reactions.map((reaction: MessageReactionItem) => (
                            <button
                              key={`${msg.id}-${reaction.emoji}`}
                              type="button"
                              className={`chat-msg__reaction-chip ${reaction.reacted_by_me ? 'is-active' : ''}`}
                              onClick={() => toggleReaction(msg.id, reaction.emoji)}
                            >
                              <span>{reaction.emoji}</span>
                              <span>{reaction.count}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="chat-composer-layer">
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

            {replyToMessage && (
              <div className="chat-reply-bar">
                <div className="chat-reply-bar__content">
                  <span className="chat-reply-bar__label">
                    Ответ на {replyToMessage.sender_username || 'сообщение'}
                  </span>
                  <span className="chat-reply-bar__text">
                    {replyPreviewText(replyToMessage)}
                  </span>
                </div>
                <button
                  type="button"
                  className="chat-reply-bar__close"
                  onClick={cancelReply}
                  aria-label="Отменить ответ"
                >
                  ×
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
