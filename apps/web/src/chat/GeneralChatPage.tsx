import type { UserDto } from '@car-city/shared/model'
import { fullName } from '../workspace'
import { ChatPanel } from './ChatPanel'
import './chat.css'

/** Full-page general chat for everyone with a session. */
export function GeneralChatPage({ users, me }: { users: UserDto[]; me: UserDto }) {
  return (
    <div className="chat-page">
      <header className="page-head">
        <div className="page-head-title">
          <span className="mono-label with-checker">Car City · {fullName(me)}</span>
          <h1>
            Общий <span className="marker">чат</span>
          </h1>
        </div>
      </header>
      <ChatPanel chatKey="general" users={users} me={me} />
    </div>
  )
}
