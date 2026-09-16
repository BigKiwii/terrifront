class TokenBucket {
  constructor(capacity, refillPerSecond, now = () => Date.now()) {
    this.capacity = Math.max(1, capacity);
    this.refillPerSecond = Math.max(0, refillPerSecond);
    this.now = now;
    this.tokens = this.capacity;
    this.updatedAt = this.now();
  }

  consume(amount = 1) {
    const currentTime = this.now();
    const elapsedSeconds = Math.max(0, currentTime - this.updatedAt) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillPerSecond);
    this.updatedAt = currentTime;
    if (this.tokens < amount) return false;
    this.tokens -= amount;
    return true;
  }
}

module.exports = TokenBucket;
