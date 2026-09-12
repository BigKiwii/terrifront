class MinHeap {
  constructor() {
    this.data = [];
  }

  push(item) {
    this.data.push(item);
    this._up(this.data.length - 1);
  }

  pop() {
    if (this.data.length === 0) return undefined;
    const top = this.data[0];
    const last = this.data.pop();
    if (this.data.length > 0) {
      this.data[0] = last;
      this._down(0);
    }
    return top;
  }

  peek() {
    return this.data[0];
  }

  get size() {
    return this.data.length;
  }

  clear() {
    this.data = [];
  }

  _up(index) {
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.data[parent].priority <= this.data[index].priority) break;
      [this.data[parent], this.data[index]] = [this.data[index], this.data[parent]];
      index = parent;
    }
  }

  _down(index) {
    const length = this.data.length;
    while (true) {
      let minimum = index;
      const left = 2 * index + 1;
      const right = 2 * index + 2;
      if (left < length && this.data[left].priority < this.data[minimum].priority) minimum = left;
      if (right < length && this.data[right].priority < this.data[minimum].priority) minimum = right;
      if (minimum === index) break;
      [this.data[minimum], this.data[index]] = [this.data[index], this.data[minimum]];
      index = minimum;
    }
  }
}

module.exports = MinHeap;
