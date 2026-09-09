'use strict';
// An in-page dialog works with keyboard, mobile browsers and assistive technology.
function askConfirmation(message) {
    if (document.querySelector('dialog[data-confirmation]')) return Promise.resolve(false);
    return new Promise(resolve => {
        const dialog = document.createElement('dialog');
        dialog.dataset.confirmation = '';
        dialog.setAttribute('aria-labelledby', 'confirmation-message');
        const form = document.createElement('form'); form.method = 'dialog';
        const description = document.createElement('p');
        description.id = 'confirmation-message'; description.textContent = message;
        const cancel = document.createElement('button');
        cancel.type = 'submit'; cancel.value = 'cancel'; cancel.textContent = 'Отмена'; cancel.autofocus = true;
        const accept = document.createElement('button');
        accept.type = 'submit'; accept.value = 'accept'; accept.textContent = 'Подтвердить';
        form.append(description, cancel, accept); dialog.append(form); document.body.append(dialog);
        dialog.addEventListener('close', () => {
            const accepted = dialog.returnValue === 'accept'; dialog.remove(); resolve(accepted);
        }, { once: true });
        dialog.showModal();
    });
}
