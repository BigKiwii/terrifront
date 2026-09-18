(function () {
  'use strict';

  const modules = window.TerriGameModules = window.TerriGameModules || {};

  function decode(data) {
    if (data.changesBuf) return data.changesBuf instanceof Int32Array ? data.changesBuf : new Int32Array(data.changesBuf);
    const changes = data.changes || [];
    if (changes instanceof Int32Array) return changes;
    const buffer = new Int32Array(changes.length * 2);
    for (let index = 0; index < changes.length; index += 1) {
      buffer[index * 2] = changes[index].position;
      buffer[index * 2 + 1] = changes[index].owner;
    }
    return buffer;
  }

  function forEach(changes, callback) {
    if (changes instanceof Int32Array) {
      for (let index = 0; index < changes.length; index += 2) callback(changes[index], changes[index + 1]);
      return;
    }
    for (const change of changes || []) callback(change.position, change.owner);
  }

  modules.changeBuffer = { decode, forEach };
}());
