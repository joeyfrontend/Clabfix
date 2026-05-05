import { EventEmitter } from 'events';

class LogStream extends EventEmitter {
  log(message: string) {
    this.emit('log', message);
  }
}

export const globalLogStream = new LogStream();
