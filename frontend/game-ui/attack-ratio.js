(function () {
  'use strict';

  const modules = window.TerriGameModules = window.TerriGameModules || {};
  const STORAGE_KEY = 'terrifront-attack-ratio';

  function createAttackRatioControl(options) {
    const slider = options.slider;
    const track = document.querySelector('.ratio-bar-track');
    const minus = document.querySelector('#ratio-minus');
    const plus = document.querySelector('#ratio-plus');
    let dragging = false;

    function persist() {
      localStorage.setItem(STORAGE_KEY, slider.value);
    }

    function setValue(value, shouldPersist = true) {
      slider.value = Math.max(1, Math.min(100, Number(value)));
      if (shouldPersist) persist();
      options.onChange();
    }

    function ratioFromEvent(event) {
      const rect = track.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      return Math.max(1, Math.round(ratio * 100));
    }

    slider.addEventListener('input', () => {
      persist();
      options.onChange();
    });

    track?.addEventListener('pointerdown', (event) => {
      dragging = true;
      track.setPointerCapture(event.pointerId);
      setValue(ratioFromEvent(event));
    });
    track?.addEventListener('pointermove', (event) => {
      if (dragging) setValue(ratioFromEvent(event));
    });
    track?.addEventListener('pointerup', () => {
      dragging = false;
      persist();
    });
    track?.addEventListener('pointercancel', () => {
      dragging = false;
      persist();
    });

    minus?.addEventListener('click', () => setValue(Number(slider.value) - 5));
    plus?.addEventListener('click', () => setValue(Number(slider.value) + 5));
    window.addEventListener('keydown', (event) => {
      if (!options.isActive() || event.target.tagName === 'INPUT') return;
      if (event.key === '1') setValue(Number(slider.value) - 5);
      if (event.key === '2') setValue(Number(slider.value) + 5);
    });

    const savedRatio = localStorage.getItem(STORAGE_KEY);
    if (savedRatio !== null && Number(savedRatio) >= 1 && Number(savedRatio) <= 100) slider.value = savedRatio;
    options.onChange();

    return {
      adjust(step) {
        setValue(Number(slider.value) + step);
      },
      getValue() {
        return Number(slider.value);
      }
    };
  }

  modules.attackRatio = { createAttackRatioControl };
}());
