/**
 * Глобальный ChatContext — постоянное WebSocket-соединение для чата.
 *
 * WebSocket живёт на уровне всего приложения (а не страницы чата),
 * поэтому уведомления о новых сообщениях приходят всегда, независимо
 * от того, на какой странице находится пользователь.
 *
 * ChatPage подключается к этому же контексту вместо создания
 * собственного WebSocket-соединения.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { tokenStorage } from '../api/client'
import { apiGetUnread, apiListRooms, type ChatRoomItem, type MessageItem, type UnreadCounts } from '../api/chat'
import { useAuth } from './AuthContext'
import { clearAppIconBadge, notify, setAppIconBadge } from '../utils/notifications'

// ── Типы ────────────────────────────────────────────────────────

export interface ChatContextValue {
  /** Список комнат пользователя. */
  rooms: ChatRoomItem[]
  /** Загрузка списка комнат. */
  loadingRooms: boolean
  /** Unread-счётчики по комнатам. */
  unread: UnreadCounts
  /** Активная комната (в ChatPage). */
  activeRoomId: number | null
  /** Установить активную комнату. */
  setActiveRoomId: (id: number | null) => void
  /** Текущий WebSocket (может быть null если нет токена). */
  ws: WebSocket | null
  /** Перезагрузить список комнат. */
  refreshRooms: () => Promise<void>
  /** Перезагрузить unread-счётчики. */
  refreshUnread: () => Promise<void>
  /** Локально сбросить unread для комнаты (после mark-as-read). */
  markRoomRead: (roomId: number) => void
}

const ChatContext = createContext<ChatContextValue | null>(null)

// WebSocket URL
const WS_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/v1/chat/ws`

// ── Провайдер ───────────────────────────────────────────────────

export function ChatProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>()
  const wsRetryCount = useRef(0)
  const activeRoomIdRef = useRef<number | null>(null)

  const [rooms, setRooms] = useState<ChatRoomItem[]>([])
  const [loadingRooms, setLoadingRooms] = useState(true)
  const [unread, setUnread] = useState<UnreadCounts>({ total: 0, rooms: {} })
  const [activeRoomId, _setActiveRoomId] = useState<number | null>(null)

  // Обёртка setActiveRoomId, которая синхронизирует ref
  const setActiveRoomId = useCallback((id: number | null) => {
    activeRoomIdRef.current = id
    _setActiveRoomId(id)
  }, [])

  // ── WebSocket: подключение ──────────────────────────────────

  const connectWs = useCallback(() => {
    const accessToken = tokenStorage.getAccess()
    if (!accessToken) {
      console.warn('[ChatContext] No access token, skipping WS connect')
      return
    }

    wsRetryCount.current += 1
    if (wsRetryCount.current > 5) {
      console.warn('[ChatContext] Too many reconnect attempts, waiting 30s')
      reconnectTimer.current = setTimeout(() => {
        wsRetryCount.current = 0
        connectWs()
      }, 30000)
      return
    }

    const delay = Math.min(1000 * Math.pow(2, wsRetryCount.current - 1), 16000)
    console.log('[ChatContext] Connecting WS in', delay, 'ms')

    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      wsRetryCount.current = 0
      ws.send(JSON.stringify({ token: accessToken }))
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)

        if (data.type === 'error' && data.error === 'Unauthorized') {
          ws.close(4001)
          return
        }

        if (data.type === 'message') {
          const msg = data.message as MessageItem
          const rid = msg.room_id
          const sender = msg.sender_full_name || msg.sender_username || 'Кто-то'
          const isOwnMessage = msg.sender_id === user?.id

          // Обновить последнее сообщение у комнаты в списке
          setRooms((prev) =>
            prev.map((r) =>
              r.id === rid ? { ...r, last_message: msg } : r,
            ),
          )

          // Если это входящее сообщение и мы не в активной комнате — увеличить unread + уведомление
          if (!isOwnMessage && rid !== activeRoomIdRef.current) {
            setUnread((prev) => {
              const roomUnread = (prev.rooms[rid] || 0) + 1
              const total = prev.total + 1
              return {
                total,
                rooms: { ...prev.rooms, [rid]: roomUnread },
              }
            })

            // 🔔 Нативное уведомление о новом сообщении
            const preview = (msg.content || '').slice(0, 120)
            notify(`💬 ${sender}`, {
              body: preview,
              tag: `chat-room-${rid}`,
              data: { url: `/chat?room=${rid}` },
              channelId: 'chat',
            })
          }
        }
      } catch {
        /* ignore invalid JSON */
      }
    }

    ws.onclose = (event) => {
      if (event.code === 4001) {
        console.warn('[ChatContext] WS auth failed, not reconnecting')
        return
      }
      console.log('[ChatContext] WS disconnected, reconnecting in 3s...')
      reconnectTimer.current = setTimeout(connectWs, 3000)
    }

    ws.onerror = () => {
      ws.close()
    }
  }, [user?.id])

  // ── REST: загрузка данных ───────────────────────────────────

  const refreshRooms = useCallback(async () => {
    try {
      const data = await apiListRooms()
      setRooms(data)
    } catch (err) {
      console.error('[ChatContext] Failed to load rooms', err)
    } finally {
      setLoadingRooms(false)
    }
  }, [])

  const markRoomRead = useCallback((roomId: number) => {
    setUnread((prev) => {
      const roomCount = prev.rooms[roomId] || 0
      if (!roomCount && !(roomId in prev.rooms)) return prev
      const nextRooms = { ...prev.rooms }
      delete nextRooms[roomId]
      return {
        total: Math.max(0, prev.total - roomCount),
        rooms: nextRooms,
      }
    })
  }, [])

  const refreshUnread = useCallback(async () => {
    try {
      const u = await apiGetUnread()
      setUnread(u)
    } catch {
      // ignore
    }
  }, [])

  // ── Подписка на изменения токена ─────────────────────────────

  // При логине/логауте токен меняется — переподключаем WebSocket.
  // Пока пользователь не авторизован, никакой чат-инфраструктуры не
  // поднимаем: это экономит время старта приложения и убирает лишние
  // запросы к бэкенду на страницах логина/регистрации.
  useEffect(() => {
    if (!user) {
      setLoadingRooms(false)
      return
    }
    connectWs()
    refreshRooms()
    refreshUnread()

    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [user, connectWs, refreshRooms, refreshUnread])

  // Синхронизация badge на иконке установленного PWA/приложения.
  // Когда приложение открыто, всегда выставляем точное количество unread.
  useEffect(() => {
    if (!user) {
      void clearAppIconBadge()
      return
    }
    void setAppIconBadge(unread.total)
  }, [unread.total, user])

  // ── Контекст ─────────────────────────────────────────────────

  const value: ChatContextValue = {
    rooms,
    loadingRooms,
    unread,
    activeRoomId,
    setActiveRoomId,
    ws: wsRef.current,
    refreshRooms,
    refreshUnread,
    markRoomRead,
  }

  return (
    <ChatContext.Provider value={value}>
      {children}
    </ChatContext.Provider>
  )
}

// ── Хук ─────────────────────────────────────────────────────────

export function useChatContext(): ChatContextValue {
  const ctx = useContext(ChatContext)
  if (!ctx) {
    throw new Error('useChatContext must be used within ChatProvider')
  }
  return ctx
}
