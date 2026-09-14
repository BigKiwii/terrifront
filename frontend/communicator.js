(function () {
  'use strict';

  const communicator = {
    socket: null,
    messageHandlers: new Map(),
    reconnectUrl: null,
    reconnectTimer: null,
    manualClose: false,
    connect(url) {
      const fallbackUrl = url || `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host || 'localhost:8080'}`;
      const finalUrl = fallbackUrl || 'ws://localhost:8080';
      this.reconnectUrl = finalUrl;
      this.manualClose = false;
      if (this.socket) return Promise.resolve(this.socket);
      return new Promise((resolve, reject) => {
        const socket = new WebSocket(finalUrl);
        socket.binaryType = 'arraybuffer';
        this.socket = socket;
        socket.addEventListener('open', () => resolve(socket));
        socket.addEventListener('message', (event) => this.receive(event.data));
        socket.addEventListener('error', reject);
        socket.addEventListener('close', () => {
          this.socket = null;
          if (this.manualClose || !this.reconnectUrl) return;
          if (this.reconnectTimer) return;
          this.reconnectTimer = window.setTimeout(() => {
            this.reconnectTimer = null;
            this.connect(this.reconnectUrl).catch(() => {});
          }, 1000);
        });
      });
    },
    disconnect() {
      this.manualClose = true;
      if (this.reconnectTimer) {
        window.clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      if (this.socket) {
        this.socket.close();
        this.socket = null;
      }
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