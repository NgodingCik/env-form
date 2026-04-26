const vscode = acquireVsCodeApi();

/**
 * @typedef {Object} EnvEntry
 * @property {string} key - The environment variable name
 * @property {string} value - The environment variable value
 * @property {string|undefined} comment - Optional comment line preceding the entry
 * @property {boolean} hidden - Whether the value is masked in the UI
 */

/** @type {EnvEntry[]} */
let envEntries = [];

/** @type {number} */
let editingIndex = -1;

/** @type {'add'|'edit'} */
let modalMode = 'add';

/** @type {string} */
let searchQuery = '';

/** @type {boolean} */
let isModalOpen = false;

/** @type {boolean} */
let isPlaintextView = false;

document.addEventListener('DOMContentLoaded', () => {
    const addEnvBtn = /** @type {HTMLButtonElement} */ (document.getElementById('add-env-btn'));
    const modalOverlay = /** @type {HTMLDivElement} */ (document.getElementById('add-modal'));
    const modalTitle = /** @type {HTMLHeadingElement} */ (document.getElementById('modal-title'));
    const saveBtn = /** @type {HTMLButtonElement} */ (document.getElementById('save-btn'));
    const cancelBtn = /** @type {HTMLButtonElement} */ (document.getElementById('cancel-btn'));
    const importBtn = /** @type {HTMLButtonElement} */ (document.getElementById('import-btn'));
    const newKeyInput = /** @type {HTMLInputElement} */ (document.getElementById('new-key'));
    const newValueInput = /** @type {HTMLInputElement} */ (document.getElementById('new-value'));
    const newNoteInput = /** @type {HTMLInputElement} */ (document.getElementById('new-note'));
    const searchInput = /** @type {HTMLInputElement} */ (document.getElementById('search-input'));
    const envList = /** @type {HTMLUListElement} */ (document.getElementById('env-list'));
    const envEmpty = /** @type {HTMLParagraphElement} */ (document.getElementById('env-empty'));
    const dropOverlay = /** @type {HTMLDivElement} */ (document.getElementById('drop-overlay'));
    const viewPlaintextBtn = document.getElementById('view-plaintext-btn');

    /**
     * Opens the add or edit modal, pre-filling fields when editing.
     * @param {'add'|'edit'} mode
     * @param {number} [index=-1]
     */
    function openModal(mode, index = -1) {
        modalMode = mode;
        editingIndex = index;
        isModalOpen = true;
        modalOverlay.classList.remove('hidden');
        modalOverlay.classList.add('flex');

        if (mode === 'edit' && index >= 0) {
            const entry = envEntries[index];
            modalTitle.textContent = 'Edit Environment Variable';
            newKeyInput.value = entry.key;
            newValueInput.value = '';
            newNoteInput.value = entry.comment ?? '';
            newKeyInput.setAttribute('readonly', 'true');
            newKeyInput.classList.add('opacity-40', 'cursor-not-allowed');
            setTimeout(() => newValueInput.focus(), 50);
        } else {
            modalTitle.textContent = 'Add Environment Variable';
            newKeyInput.value = '';
            newValueInput.value = '';
            newNoteInput.value = '';
            newKeyInput.removeAttribute('readonly');
            newKeyInput.classList.remove('opacity-40', 'cursor-not-allowed');
            setTimeout(() => newKeyInput.focus(), 50);
        }
    }

    /**
     * Closes the modal and resets all form fields.
     */
    function closeModal() {
        isModalOpen = false;
        editingIndex = -1;
        modalOverlay.classList.add('hidden');
        modalOverlay.classList.remove('flex');
        newKeyInput.value = '';
        newValueInput.value = '';
        newNoteInput.value = '';
        newKeyInput.removeAttribute('readonly');
        newKeyInput.classList.remove('opacity-40', 'cursor-not-allowed');
    }

    addEnvBtn.addEventListener('click', () => openModal('add'));
    cancelBtn.addEventListener('click', closeModal);

    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) closeModal();
    });

    document.addEventListener('keydown', (e) => {
        if (!isModalOpen) return;
        if (e.key === 'Escape') closeModal();
        if (e.key === 'Enter' && e.target !== cancelBtn) saveBtn.click();
    });

    newKeyInput.addEventListener('paste', (e) => {
        const pasted = (e.clipboardData ?? window.clipboardData).getData('text');
        const lines = pasted.split('\n').map(l => l.trim()).filter(Boolean);
        const isMultiVar = lines.length > 1 && lines.some(l => l.includes('='));
        const isSingleEnv = lines.length === 1 && lines[0].includes('=');

        if (isMultiVar) {
            e.preventDefault();
            mergeEntries(parseEnvText(pasted));
            closeModal();
            return;
        }

        if (isSingleEnv) {
            e.preventDefault();
            const eqIdx = lines[0].indexOf('=');
            newKeyInput.value = lines[0].substring(0, eqIdx).trim();
            newValueInput.value = lines[0].substring(eqIdx + 1);
            newValueInput.focus();
        }
    });

    newKeyInput.addEventListener('input', () => {
        const val = newKeyInput.value;
        const eqIdx = val.indexOf('=');
        if (eqIdx > 0) {
            newKeyInput.value = val.substring(0, eqIdx).trim().toUpperCase().replace(/\s+/g, '_');
            newValueInput.value = val.substring(eqIdx + 1);
            newValueInput.focus();
        }
    });

    saveBtn.addEventListener('click', () => {
        const key = newKeyInput.value.trim();
        const value = newValueInput.value;
        const note = newNoteInput.value.trim();
        if (!key) {
            newKeyInput.focus();
            return;
        }

        if (modalMode === 'edit' && editingIndex >= 0) {
            envEntries[editingIndex] = {
                key,
                value,
                comment: note || undefined,
                hidden: envEntries[editingIndex].hidden,
            };
        } else {
            const existing = envEntries.findIndex(e => e.key === key);
            if (existing >= 0) {
                envEntries[existing] = {
                    key, value,
                    comment: note || undefined,
                    hidden: envEntries[existing].hidden,
                };
            } else {
                envEntries.push({ key, value, comment: note || undefined, hidden: true });
            }
        }

        renderEnvList();
        saveToExtension();
        closeModal();
    });

    importBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'importEnv' });
    });

    searchInput.addEventListener('input', () => {
        searchQuery = searchInput.value.toLowerCase();
        renderEnvList();
    });

    viewPlaintextBtn.addEventListener('click', () => {
        isPlaintextView = true;
        vscode.postMessage({ type: 'openPlaintext' });
    });

    let dragCounter = 0;

    document.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        dropOverlay.classList.remove('hidden');
        dropOverlay.classList.add('flex');
    });

    document.addEventListener('dragleave', () => {
        dragCounter = Math.max(0, dragCounter - 1);
        if (dragCounter === 0) dropOverlay.classList.add('hidden'), dropOverlay.classList.remove('flex');
    });

    document.addEventListener('dragover', (e) => e.preventDefault());

    document.addEventListener('drop', (e) => {
        e.preventDefault();
        dragCounter = 0;
        dropOverlay.classList.add('hidden');
        dropOverlay.classList.remove('flex');

        const file = e.dataTransfer?.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (ev) => {
            const text = ev.target?.result;
            if (typeof text === 'string') mergeEnvText(text);
        };
        reader.readAsText(file);
    });

    window.addEventListener('message', (event) => {
        const message = event.data;
        switch (message.type) {
            case 'update':
                envEntries = parseEnvText(message.text);
                renderEnvList();
                break;
            case 'importedEnv':
                mergeEnvText(message.text);
                break;
        }
    });

    /**
     * Parses a raw .env string into an array of EnvEntry objects.
     * Lines beginning with `#` are treated as comments for the following entry.
     * @param {string} text
     * @returns {EnvEntry[]}
     */
    function parseEnvText(text) {
        const lines = text.split('\n');
        /** @type {EnvEntry[]} */
        const entries = [];
        let pendingComment = '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) {
                pendingComment = '';
                continue;
            }
            if (trimmed.startsWith('#')) {
                pendingComment = trimmed.slice(1).trim();
                continue;
            }
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx === -1) continue;
            const key = trimmed.substring(0, eqIdx).trim();
            const value = trimmed.substring(eqIdx + 1);
            if (!key) continue;
            entries.push({ key, value, comment: pendingComment || undefined, hidden: true });
            pendingComment = '';
        }

        return entries;
    }

    /**
     * Serializes an array of EnvEntry objects back to .env file format.
     * @param {EnvEntry[]} entries
     * @returns {string}
     */
    function serializeEntries(entries) {
        return entries.map((entry) => {
            let line = '';
            if (entry.comment) line += `# ${entry.comment}\n`;
            line += `${entry.key}=${entry.value}`;
            return line;
        }).join('\n');
    }

    /**
     * Merges a list of parsed entries into the current state, updating duplicates.
     * @param {EnvEntry[]} parsed
     */
    function mergeEntries(parsed) {
        parsed.forEach((entry) => {
            const idx = envEntries.findIndex(e => e.key === entry.key);
            if (idx >= 0) {
                envEntries[idx] = { ...entry, hidden: envEntries[idx].hidden };
            } else {
                envEntries.push(entry);
            }
        });
        renderEnvList();
        saveToExtension();
    }

    /**
     * Parses a raw .env string and merges it into the current state.
     * @param {string} text
     */
    function mergeEnvText(text) {
        mergeEntries(parseEnvText(text));
    }

    /**
     * Returns a fixed-length bullet string to mask a secret value.
     * @param {string} value
     * @returns {string}
     */
    function maskValue(value) {
        return '●'.repeat(Math.min(Math.max(value.length, 8), 24));
    }

    /**
     * Re-renders the full list of environment variables based on current state and search query.
     */
    function renderEnvList() {
        envList.innerHTML = '';

        const filtered = envEntries.filter(e =>
            e.key.toLowerCase().includes(searchQuery) ||
            e.value.toLowerCase().includes(searchQuery) ||
            (e.comment ?? '').toLowerCase().includes(searchQuery)
        );

        envEmpty.classList.toggle('hidden', filtered.length > 0);

        filtered.forEach((entry) => {
            const realIdx = envEntries.indexOf(entry);
            const li = document.createElement('li');
            li.className = 'flex items-center justify-between p-3 gap-3 hover:bg-gray-500/20';

            const info = document.createElement('div');
            info.className = 'flex-1 min-w-0';

            const keyEl = document.createElement('h2');
            keyEl.className = 'font-medium truncate font-mono text-sm';
            keyEl.textContent = entry.key;

            const valEl = document.createElement('p');
            valEl.className = 'text-sm text-gray-400 font-mono truncate mt-0.5';
            valEl.textContent = entry.hidden
                ? maskValue("VERISIKRITTTTPLISSDONTTTHEEEKK") // Fixed length for security purposes, not revealing actual length
                : (entry.value.length > 0 ? entry.value : '(empty)');

            info.appendChild(keyEl);
            info.appendChild(valEl);

            if (entry.comment) {
                const noteEl = document.createElement('p');
                noteEl.className = 'text-xs text-gray-500 truncate mt-0.5';
                noteEl.textContent = entry.comment;
                info.appendChild(noteEl);
            }

            const actions = document.createElement('div');
            actions.className = 'flex items-center gap-3 shrink-0';

            const editBtn = createIconBtn('text-blue-500 hover:text-blue-400', pencilSvg(), 'Edit');
            editBtn.addEventListener('click', () => openModal('edit', realIdx));

            const deleteBtn = createIconBtn('text-red-500 hover:text-red-400', trashSvg(), 'Delete');
            deleteBtn.addEventListener('click', () => {
                envEntries.splice(realIdx, 1);
                renderEnvList();
                saveToExtension();
            });

            const toggleBtn = createIconBtn(
                'text-gray-400 hover:text-gray-200',
                entry.hidden ? eyeSlashSvg() : eyeSvg(),
                entry.hidden ? 'Show value' : 'Hide value'
            );
            toggleBtn.addEventListener('click', () => {
                envEntries[realIdx].hidden = !envEntries[realIdx].hidden;
                renderEnvList();
            });

            actions.appendChild(editBtn);
            actions.appendChild(deleteBtn);
            actions.appendChild(toggleBtn);

            li.appendChild(info);
            li.appendChild(actions);
            envList.appendChild(li);
        });
    }

    /**
     * Creates a styled icon button element.
     * @param {string} colorClass - Tailwind color/hover classes
     * @param {string} svgHtml - Inner SVG markup
     * @param {string} title - Tooltip title
     * @returns {HTMLButtonElement}
     */
    function createIconBtn(colorClass, svgHtml, title) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `w-5 h-5 ${colorClass}`;
        btn.title = title;
        btn.innerHTML = svgHtml;
        return btn;
    }

    /**
     * @returns {string}
     */
    function pencilSvg() {
        return '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0l1.293 1.293zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12l6.813-6.814z"/><path fill-rule="evenodd" d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5z"/></svg>';
    }

    /**
     * @returns {string}
     */
    function trashSvg() {
        return '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/><path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/></svg>';
    }

    /**
     * @returns {string}
     */
    function eyeSvg() {
        return '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8M1.173 8a13 13 0 0 1 1.66-2.043C4.12 4.668 5.88 3.5 8 3.5s3.879 1.168 5.168 2.457A13 13 0 0 1 14.828 8q-.086.13-.195.288c-.335.48-.83 1.12-1.465 1.755C11.879 11.332 10.119 12.5 8 12.5s-3.879-1.168-5.168-2.457A13 13 0 0 1 1.172 8z"/><path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5M4.5 8a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0"/></svg>';
    }

    /**
     * @returns {string}
     */
    function eyeSlashSvg() {
        return '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M13.359 11.238C15.06 9.72 16 8 16 8s-3-5.5-8-5.5a7 7 0 0 0-2.79.588l.77.771A6 6 0 0 1 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13 13 0 0 1 14.828 8q-.086.13-.195.288c-.335.48-.83 1.12-1.465 1.755q-.247.248-.517.486z"/><path d="M11.297 9.176a3.5 3.5 0 0 0-4.474-4.474l.823.823a2.5 2.5 0 0 1 2.829 2.829zm-2.943 1.299.822.822a3.5 3.5 0 0 1-4.474-4.474l.823.823a2.5 2.5 0 0 0 2.829 2.829"/><path d="M3.35 5.47q-.27.24-.518.487A13 13 0 0 0 1.172 8l.195.288c.335.48.83 1.12 1.465 1.755C4.121 11.332 5.881 12.5 8 12.5c.716 0 1.39-.133 2.02-.36l.77.772A7 7 0 0 1 8 13.5C3 13.5 0 8 0 8s.939-1.721 2.641-3.238l.708.709zm10.296 8.884-12-12 .708-.708 12 12z"/></svg>';
    }

    /**
     * Sends the full serialized env text to the extension host for saving to disk.
     */
    function saveToExtension() {
        vscode.postMessage({
            type: 'save',
            text: serializeEntries(envEntries),
        });
    }

    vscode.postMessage({ type: 'ready' });
});