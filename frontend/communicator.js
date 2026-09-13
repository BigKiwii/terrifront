(function () {
  'use strict';

  const communicator = {
    socket: null,
    messageHandlers: new Map(),
    connect(url = 'ws://localhost:8080') {
      if (this.socket) return Promise.resolve(this.socket);
      return new Promise((resolve, reject) => {
        const socket = new WebSocket(url);
        socket.binaryType = 'arraybuffer';
        this.socket = socket;
        socket.addEventListener('open', () => resolve(socket));
        socket.addEventListener('message', (event) => this.receive(event.data));
        socket.addEventListener('error', reject);
        socket.addEventListener('close', () => { this.socket = null; });
      });
    },
    send(buffer) {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
      this.socket.send(buffer);
      return true;
    },
    on(opcode, handler) {
      this.messageHandlers.set(opcode, handler);
    },
    receive(rawMessage) {
      try {
        const message = window.TerriBinaryProtocol.decodeServerMessage(rawMessage);
        const handler = this.messageHandlers.get(message.opcode);
        if (handler) handler(message);
      } catch (error) {
        console.error('Unable to decode server message:', error);
      }
    }
  };

  window.TerriCommunicator = communicator;
}());