// change-password.js -- adds a "change password" key icon to any
// dashboard header, next to Logout. Include with:
// <script src="change-password.js"></script>

(function () {
    const personId = localStorage.getItem('userId');
    if (!personId) return;

    const style = document.createElement('style');
    style.textContent = `
        .cp-link { color: #adb5bd; font-size: 15px; text-decoration: none; cursor: pointer; padding: 4px; }
        .cp-link:hover { color: #fff; }
        .cp-overlay { display: none; position: fixed; top:0; left:0; right:0; bottom:0; background: rgba(0,0,0,0.5); z-index: 2000; align-items: center; justify-content: center; }
        .cp-overlay.open { display: flex; }
        .cp-modal { background: #fff; border-radius: 8px; padding: 25px; width: 340px; max-width: 90vw; box-shadow: 0 10px 30px rgba(0,0,0,0.3); }
        .cp-modal h3 { margin: 0 0 4px 0; font-size: 16px; color: #0d1b2a; }
        .cp-modal label { display:block; font-size:13px; font-weight:600; color:#495057; margin-bottom:6px; margin-top:14px; }
        .cp-modal input { width:100%; padding:9px 12px; border:1px solid #ced4da; border-radius:4px; font-size:14px; box-sizing:border-box; }
        .cp-modal-actions { display:flex; gap:10px; margin-top:20px; }
        .cp-btn { flex:1; padding:9px; border-radius:4px; font-size:13px; font-weight:600; border:none; cursor:pointer; }
        .cp-btn-cancel { background:#e9ecef; color:#495057; }
        .cp-btn-save { background:#4a154b; color:#fff; }
        .cp-message { font-size:12px; margin-top:12px; min-height:16px; }
    `;
    document.head.appendChild(style);

    const emailSpan = document.getElementById('userEmailDisplay');
    if (!emailSpan) return;
    const headerGroup = emailSpan.closest('div');
    if (!headerGroup) return;

    const link = document.createElement('a');
    link.className = 'cp-link';
    link.innerHTML = '<i class="fas fa-key"></i>';
    link.title = 'Change Password';
    headerGroup.insertBefore(link, headerGroup.lastElementChild); // sits just before the Logout link

    const overlay = document.createElement('div');
    overlay.className = 'cp-overlay';
    overlay.innerHTML = `
        <div class="cp-modal">
            <h3>Change Password</h3>
            <label>Current Password</label>
            <input type="password" id="cpCurrent">
            <label>New Password</label>
            <input type="password" id="cpNew">
            <label>Confirm New Password</label>
            <input type="password" id="cpConfirm">
            <div class="cp-message" id="cpMessage"></div>
            <div class="cp-modal-actions">
                <button class="cp-btn cp-btn-cancel" id="cpCancel">Cancel</button>
                <button class="cp-btn cp-btn-save" id="cpSave">Save</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    link.addEventListener('click', () => {
        document.getElementById('cpCurrent').value = '';
        document.getElementById('cpNew').value = '';
        document.getElementById('cpConfirm').value = '';
        document.getElementById('cpMessage').textContent = '';
        overlay.classList.add('open');
    });

    document.getElementById('cpCancel').addEventListener('click', () => overlay.classList.remove('open'));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('open'); });

    document.getElementById('cpSave').addEventListener('click', async () => {
        const current = document.getElementById('cpCurrent').value;
        const next = document.getElementById('cpNew').value;
        const confirmVal = document.getElementById('cpConfirm').value;
        const msg = document.getElementById('cpMessage');

        if (!current || !next || !confirmVal) { msg.style.color = '#c92a2a'; msg.textContent = 'Please fill in all fields.'; return; }
        if (next !== confirmVal) { msg.style.color = '#c92a2a'; msg.textContent = 'New passwords do not match.'; return; }
        if (next.length < 6) { msg.style.color = '#c92a2a'; msg.textContent = 'New password must be at least 6 characters.'; return; }

        try {
            const res = await fetch(`/api/change-password/${personId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ currentPassword: current, newPassword: next })
            });
            const data = await res.json();
            if (res.ok) {
                msg.style.color = '#2b8a3e';
                msg.textContent = 'Password changed successfully!';
                setTimeout(() => overlay.classList.remove('open'), 1200);
            } else {
                msg.style.color = '#c92a2a';
                msg.textContent = data.error || 'Failed to change password.';
            }
        } catch (err) {
            console.error(err);
            msg.style.color = '#c92a2a';
            msg.textContent = 'Could not reach the server.';
        }
    });
})();


