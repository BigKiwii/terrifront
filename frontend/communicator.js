(function () {
  'use strict';

  const communicator = {
    socket: null,
    messageHandlers: new Map(),
    connect(url = 'ws://localhost:8080') {
      if (this.socket) return Promise.resolve(this.socket);
      return new Promise((resolve, reject) => {
        const socket = new WebSocket(url);
        this.socket = socket;
        socket.addEventListener('open', () => resolve(socket));
        socket.addEventListener('message', (event) => this.receive(event.data));
        socket.addEventListener('error', reject);
        socket.addEventListener('close', () => { this.socket = null; });
      });
    },
    send(code, payload) {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
      const requestId = `request-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      this.socket.send(JSON.stringify({ code, requestId, payload }));
      return requestId;
    },
    on(code, handler) {
      this.messageHandlers.set(code, handler);
    },
    receive(rawMessage) {
      const message = JSON.parse(rawMessage);
      const handler = this.messageHandlers.get(message.code);
      if (handler) handler(message);
    }
  };

  window.TerriCommunicator = communicator;
}());