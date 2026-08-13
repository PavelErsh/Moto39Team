import { useCallback, useEffect, useRef, useState } from 'react'
import { tokenStorage } from '../api/client'
import { apiGetMessages, apiListRooms, apiMarkRead } from '../api/chat'
import type { ChatRoomItem, MessageItem, UnreadCounts } from '../api/chat'
import { useAuth } from '../context/AuthContext'
import { notify } from '../utils/notifications'

// WebSocket URL — относительный путь (проксируется через nginx/vite)
const WS_BASE = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`

export interface ChatState {
  rooms: ChatRoomItem[]
  messages: Record<number, MessageItem[]>
  activeRoomId: number | null
  unread: UnreadCounts
  loadingRooms: boolean
  loadingMessages: boolean
}

export function useChat() {
  const { user } = useAuth()
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>()

  const [rooms, setRooms] = useState<ChatRoomItem[]>([])
  const [messages, setMessages] = useState<Record<number, MessageItem[]>>({})
  const [activeRoomId, setActiveRoomId] = useState<number | null>(null)
  const [unread, setUnread] = useState<UnreadCounts>({ total: 0, rooms: {} })
  const [loadingRooms, setLoadingRooms] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)

  // ── REST: Загрузка комнат ─────────────────────────────────────

  const loadRooms = useCallback(async () => {
    try {
      const data = await apiListRooms()
      setRooms(data)
    } catch (err) {
      console.error('Failed to load rooms', err)
    } finally {
      setLoadingRooms(false)
    }
  }, [])

  // ── REST: Загрузка сообщений ──────────────────────────────────

  const loadMessages = useCallback(
    async (roomId: number, beforeId?: number) => {
      setLoadingMessages(true)
      try {
        const msgs = await apiGetMessages(roomId, beforeId)
        setMessages((prev) => ({
          ...prev,
          [roomId]: beforeId
            ? [...msgs, ...(prev[roomId] || [])]
            : msgs,
        }))
      } catch (err) {
        console.error('Failed to load messages', err)
      } finally {
        setLoadingMessages(false)
      }
    },
    [],
  )

  // ── WebSocket ─────────────────────────────────────────────────

  const connectWs = useCallback(() => {
    const token = tokenStorage.getAccess()
    if (!token) return

    const ws = new WebSocket(`${WS_BASE}/api/v1/chat/ws`)
    wsRef.current = ws

    ws.onopen = () => {
      // Отправляем токен
      ws.send(JSON.stringify({ token }))
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)

        switch (data.type) {
          case 'connected':
            console.log('Chat WS connected, user:', data.user_id)
            break

          case 'message': {
            const msg = data.message as MessageItem
            const rid = data.room_id as number
            const isOwnMessage = msg.sender_id === user?.id
            setMessages((prev) => {
              const existing = prev[rid] || []
              // Не добавляем дубликаты
              if (existing.some((m) => m.id === msg.id)) return prev
              return { ...prev, [rid]: [...existing, msg] }
            })
            // Обновить last_message у комнаты
            setRooms((prev) =>
              prev.map((r) =>
                r.id === rid ? { ...r, last_message: msg } : r,
              ),
            )
            // Увеличить unread только для входящих сообщений не в активной комнате
            if (!isOwnMessage && rid !== activeRoomId) {
              setUnread((prev) => ({
                total: prev.total + 1,
                rooms: {
                  ...prev.rooms,
                  [rid]: (prev.rooms[rid] || 0) + 1,
                },
              }))
              // Показать нативное уведомление о новом сообщении
              const sender = msg.sender_full_name || msg.sender_username || 'Кто-то'
              const preview = (msg.content || '').slice(0, 120)
              notify(`💬 ${sender}`, {
                body: preview,
                tag: `chat-room-${rid}`,
                data: { url: `/chat?room=${rid}` },
                channelId: 'chat',
              })
            }
            break
          }

          case 'typing':
            // Можно добавить индикатор «печатает...»
            break

          case 'error':
            console.warn('Chat WS error:', data.error)
            break
        }
      } catch {
        // невалидный JSON — игнорируем
      }
    }

    ws.onclose = () => {
      console.log('Chat WS disconnected, reconnecting in 3s...')
      reconnectTimer.current = setTimeout(connectWs, 3000)
    }

    ws.onerror = () => {
      ws.close()
    }
  }, [activeRoomId, user?.id])

  // Подключение/отключение WebSocket
  useEffect(() => {
    connectWs()
    loadRooms()

    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connectWs, loadRooms])

  // ── Действия ──────────────────────────────────────────────────

  const sendMessage = useCallback(
    (content: string, roomId: number) => {
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      ws.send(
        JSON.stringify({
          type: 'message',
          room_id: roomId,
          content,
          message_type: 'text',
        }),
      )
    },
    [],
  )

  const joinRoom = useCallback((roomId: number) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'join', room_id: roomId }))
  }, [])

  const leaveRoom = useCallback((roomId: number) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'leave', room_id: roomId }))
  }, [])

  const sendTyping = useCallback((roomId: number) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'typing', room_id: roomId }))
  }, [])

  const markAsRead = useCallback(
    async (roomId: number, messageId: number) => {
      try {
        await apiMarkRead(roomId, messageId)
        setUnread((prev) => {
          const newRooms = { ...prev.rooms }
          delete newRooms[roomId]
          return {
            total: Math.max(0, prev.total - (prev.rooms[roomId] || 0)),
            rooms: newRooms,
          }
        })
        // Отправить через WS
        const ws = wsRef.current
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: 'read',
              room_id: roomId,
              message_id: messageId,
            }),
          )
        }
      } catch {
        // ignore
      }
    },
    [],
  )

  const openRoom = useCallback(
    async (roomId: number) => {
      setActiveRoomId(roomId)
      joinRoom(roomId)
      if (!messages[roomId]) {
        await loadMessages(roomId)
      }
      // Отметить прочитанным
      const msgs = messages[roomId]
      if (msgs && msgs.length > 0) {
        const lastMsg = msgs[msgs.length - 1]
        await markAsRead(roomId, lastMsg.id)
      }
    },
    [joinRoom, loadMessages, markAsRead, messages],
  )

  const closeRoom = useCallback(() => {
    if (activeRoomId) {
      leaveRoom(activeRoomId)
    }
    setActiveRoomId(null)
  }, [activeRoomId, leaveRoom])

  return {
    rooms,
    messages,
    activeRoomId,
    unread,
    loadingRooms,
    loadingMessages,
    openRoom,
    closeRoom,
    sendMessage,
    sendTyping,
    markAsRead,
    loadMessages,
    loadRooms,
  }
}
