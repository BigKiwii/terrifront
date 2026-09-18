(function () {
  'use strict';

  const modules = window.TerriGameModules = window.TerriGameModules || {};

  function createMapMenu(options) {
    const menu = options.menu;
    const screen = options.screen;
    let position = null;

    function hide() {
      if (menu.hidden) return;
      menu.hidden = true;
      position = null;
    }

    menu.addEventListener('click', (event) => {
      const action = event.target.closest('.map-menu-item')?.dataset.action;
      if (!action || position === null) return;
      const selectedPosition = position;
      hide();
      options.onAction(action, selectedPosition);
    });

    document.addEventListener('pointerdown', (event) => {
      if (menu.hidden || menu.contains(event.target)) return;
      hide();
    });

    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') hide();
    });

    return {
      show(event, nextPosition, canLaunchBoat) {
        position = nextPosition;
        const bounds = screen.getBoundingClientRect();
        menu.hidden = false;
        const attackButton = menu.querySelector('[data-action="attack"]');
        const boatButton = menu.querySelector('[data-action="boat"]');
        boatButton.hidden = !canLaunchBoat;
        const width = menu.offsetWidth || 34;
        const height = menu.offsetHeight || (canLaunchBoat ? 74 : 34);
        const attackWidth = attackButton?.offsetWidth || 34;
        const attackHeight = attackButton?.offsetHeight || 34;
        const pointerX = event.clientX - bounds.left;
        const pointerY = event.clientY - bounds.top;
        const x = pointerX - attackWidth / 2;
        const y = pointerY - attackHeight / 2;
        menu.style.left = `${Math.min(Math.max(4, x), Math.max(4, bounds.width - width - 4))}px`;
        menu.style.top = `${Math.min(Math.max(4, y), Math.max(4, bounds.height - height - 4))}px`;
      },
      hide
    };
  }

  modules.mapMenu = { createMapMenu };
}());
