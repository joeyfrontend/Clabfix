export type MessageRole = 'user' | 'model';

export type MessageType = 'diagnostic' | 'chat' | 'fix';

export type TabType = 'chat' | 'topology' | 'logs' | 'connectivity';

export type Message = {
  id: string;
  role: MessageRole;
  content: string;
  type?: MessageType;
  timestamp: Date;
  dismissed?: boolean;
};

export type NodeInfo = {
  name: string;
  kind?: string;
  image?: string;
  status: 'running' | 'error' | 'unknown';
};

export type LinkInfo = {
  sourceNode: string;
  sourceInterface: string;
  targetNode: string;
  targetInterface: string;
};

let _idCounter = 0;
export function createMessage(
  role: MessageRole,
  content: string,
  type: MessageType = 'chat'
): Message {
  return {
    id: `msg-${Date.now()}-${++_idCounter}`,
    role,
    content,
    type,
    timestamp: new Date(),
  };
}
