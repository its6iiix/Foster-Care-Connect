/* ==========================================================
   FOSTERCARE CONNECT
   GLOBAL TOAST + CONFIRMATION SYSTEM
   ========================================================== */

(function () {

    "use strict";


    // ======================================================
    // GLOBAL TOAST STYLES
    // ======================================================

    const toastStyle =
        document.createElement("style");


    toastStyle.textContent = `

        /* ==================================================
           TOAST CONTAINER
           ================================================== */

        #fosterToastContainer {

            position: fixed;

            top: 38px;
            right: 28px;

            width: 295px;

            max-width:
                calc(100vw - 32px);

            z-index: 2147483647;

            display: flex;

            flex-direction: column;

            gap: 10px;

            pointer-events: none;

        }


        /* ==================================================
           TOAST
           ================================================== */

        .foster-toast {

            position: relative;

            min-height: 44px;

            display: flex;

            align-items: center;

            box-sizing: border-box;

            background: #ffffff;

            color: #555555;

            font-family:
                Arial,
                Helvetica,
                sans-serif;

            font-size: 14px;

            font-weight: 400;

            line-height: 1.4;

            padding:
                13px
                42px
                13px
                16px;

            border-radius: 7px;

            border-left:
                4px solid #17a2b8;

            box-shadow:
                0 3px 12px
                rgba(0, 0, 0, 0.15);

            pointer-events: auto;

            opacity: 0;

            transform:
                translateY(-8px);

            transition:
                opacity 0.22s ease,
                transform 0.22s ease;

        }


        .foster-toast.show {

            opacity: 1;

            transform:
                translateY(0);

        }


        .foster-toast.hide {

            opacity: 0;

            transform:
                translateY(-8px);

        }


        /* ==================================================
           TOAST TYPES
           ================================================== */

        .foster-toast.info {

            border-left-color:
                #17a2b8;

        }


        .foster-toast.success {

            border-left-color:
                #28a745;

        }


        .foster-toast.error {

            border-left-color:
                #dc3545;

        }


        .foster-toast.warning {

            border-left-color:
                #f0ad4e;

        }


        /* ==================================================
           TOAST MESSAGE
           ================================================== */

        .foster-toast-message {

            flex: 1;

        }


        /* ==================================================
           CLOSE BUTTON
           ================================================== */

        .foster-toast-close {

            position: absolute;

            right: 12px;

            top: 50%;

            transform:
                translateY(-50%);

            border: none;

            outline: none;

            background: transparent;

            color: #999999;

            font-size: 17px;

            font-weight: 400;

            cursor: pointer;

            padding: 4px;

            line-height: 1;

        }


        .foster-toast-close:hover {

            color: #444444;

        }


        /* ==================================================
           CONFIRMATION OVERLAY
           ================================================== */

        .foster-confirm-overlay {

            position: fixed;

            inset: 0;

            z-index: 2147483646;

            background:
                rgba(0, 0, 0, 0.35);

            display: flex;

            align-items: center;

            justify-content: center;

            padding: 20px;

        }


        /* ==================================================
           CONFIRMATION BOX
           ================================================== */

        .foster-confirm {

            width: 360px;

            max-width: 100%;

            background: #ffffff;

            border-radius: 8px;

            border-left:
                4px solid #f0ad4e;

            box-shadow:
                0 5px 22px
                rgba(0, 0, 0, 0.22);

            padding: 20px;

            font-family:
                Arial,
                Helvetica,
                sans-serif;

        }


        .foster-confirm-title {

            font-size: 16px;

            font-weight: 700;

            color: #333333;

            margin-bottom: 10px;

        }


        .foster-confirm-message {

            color: #555555;

            font-size: 14px;

            line-height: 1.5;

            margin-bottom: 20px;

        }


        /* ==================================================
           CONFIRMATION BUTTONS
           ================================================== */

        .foster-confirm-buttons {

            display: flex;

            justify-content: flex-end;

            gap: 9px;

        }


        .foster-confirm-buttons button {

            border: none;

            border-radius: 5px;

            padding:
                8px 16px;

            font-size: 13px;

            font-weight: 600;

            cursor: pointer;

        }


        .foster-confirm-cancel {

            background: #eeeeee;

            color: #444444;

        }


        .foster-confirm-ok {

            background: #4a154b;

            color: #ffffff;

        }


        .foster-confirm-cancel:hover {

            background: #dddddd;

        }


        .foster-confirm-ok:hover {

            opacity: 0.9;

        }


        /* ==================================================
           MOBILE
           ================================================== */

        @media (max-width: 600px) {

            #fosterToastContainer {

                top: 20px;

                left: 16px;

                right: 16px;

                width: auto;

                max-width: none;

            }

        }

    `;


    document.head.appendChild(
        toastStyle
    );


    // ======================================================
    // GET / CREATE TOAST CONTAINER
    // ======================================================

    function getToastContainer() {

        let container =
            document.getElementById(
                "fosterToastContainer"
            );


        if (!container) {

            container =
                document.createElement(
                    "div"
                );


            container.id =
                "fosterToastContainer";


            document.body.appendChild(
                container
            );

        }


        return container;

    }


    // ======================================================
    // AUTOMATICALLY DETECT MESSAGE TYPE
    // ======================================================

    function detectToastType(message) {

        const text =
            String(
                message || ""
            )
                .toLowerCase();


        // SUCCESS

        if (

            text.includes("success") ||

            text.includes(
                "successfully"
            ) ||

            text.includes("saved") ||

            text.includes("updated") ||

            text.includes("approved") ||

            text.includes("submitted") ||

            text.includes("created") ||

            text.includes("added") ||

            text.includes("sent") ||

            text.includes("completed") ||

            text.includes("deleted") ||

            text.includes("removed")

        ) {

            return "success";

        }


        // ERROR

        if (

            text.includes("error") ||

            text.includes("failed") ||

            text.includes("invalid") ||

            text.includes("incorrect") ||

            text.includes(
                "could not"
            ) ||

            text.includes("unable") ||

            text.includes("denied") ||

            text.includes(
                "not found"
            )

        ) {

            return "error";

        }


        // WARNING

        if (

            text.includes("warning") ||

            text.includes("required") ||

            text.includes("please") ||

            text.includes("missing") ||

            text.includes("cannot") ||

            text.includes("already")

        ) {

            return "warning";

        }


        return "info";

    }


    // ======================================================
    // REMOVE TOAST
    // ======================================================

    function removeToast(toast) {

        if (!toast) {

            return;

        }


        toast.classList.remove(
            "show"
        );


        toast.classList.add(
            "hide"
        );


        setTimeout(

            function () {

                if (
                    toast.parentNode
                ) {

                    toast.remove();

                }

            },

            220

        );

    }


    // ======================================================
    // SHOW TOAST
    // ======================================================

    window.showToast =
        function (
            message,
            type,
            duration
        ) {


            if (

                message === undefined ||

                message === null ||

                String(message)
                    .trim() === ""

            ) {

                return;

            }


            // Automatically detect type
            // when one wasn't supplied.

            type =
                type ||
                detectToastType(
                    message
                );


            duration =
                duration === undefined
                    ? 4000
                    : duration;


            const container =
                getToastContainer();


            const toast =
                document.createElement(
                    "div"
                );


            toast.className =
                "foster-toast " +
                type;


            // Message

            const messageBox =
                document.createElement(
                    "div"
                );


            messageBox.className =
                "foster-toast-message";


            messageBox.textContent =
                String(message);


            // Close button

            const closeButton =
                document.createElement(
                    "button"
                );


            closeButton.type =
                "button";


            closeButton.className =
                "foster-toast-close";


            closeButton.setAttribute(

                "aria-label",

                "Close notification"

            );


            closeButton.innerHTML =
                "&times;";


            // Add elements

            toast.appendChild(
                messageBox
            );


            toast.appendChild(
                closeButton
            );


            container.appendChild(
                toast
            );


            // Animate in

            requestAnimationFrame(

                function () {

                    requestAnimationFrame(

                        function () {

                            toast.classList.add(
                                "show"
                            );

                        }

                    );

                }

            );


            // Auto remove

            let timer = null;


            if (
                Number(duration) > 0
            ) {

                timer =
                    setTimeout(

                        function () {

                            removeToast(
                                toast
                            );

                        },

                        Number(duration)

                    );

            }


            // Manual close

            closeButton.addEventListener(

                "click",

                function () {

                    if (timer) {

                        clearTimeout(
                            timer
                        );

                    }


                    removeToast(
                        toast
                    );

                }

            );


            return toast;

        };


    // ======================================================
    // SHORTCUT FUNCTIONS
    // ======================================================

    window.toastSuccess =
        function (message) {

            return window.showToast(

                message,

                "success"

            );

        };


    window.toastError =
        function (message) {

            return window.showToast(

                message,

                "error",

                5000

            );

        };


    window.toastWarning =
        function (message) {

            return window.showToast(

                message,

                "warning"

            );

        };


    window.toastInfo =
        function (message) {

            return window.showToast(

                message,

                "info"

            );

        };


    // ======================================================
    // REPLACE ALL alert() POPUPS
    // ======================================================

    /*
        This means existing code such as:

        alert("Role permission updated successfully.");

        automatically becomes a toast.
    */

    window.alert =
        function (message) {

            window.showToast(

                message,

                detectToastType(
                    message
                )

            );

        };


    // ======================================================
    // CUSTOM CONFIRMATION
    // ======================================================

    /*
        Usage:

        const confirmed =
            await showConfirm(
                "Are you sure you want to delete this user?"
            );

        if (!confirmed) {
            return;
        }
    */

    window.showConfirm =
        function (
            message,
            title = "Confirm Action"
        ) {


            return new Promise(

                function (resolve) {


                    const overlay =
                        document.createElement(
                            "div"
                        );


                    overlay.className =
                        "foster-confirm-overlay";


                    const box =
                        document.createElement(
                            "div"
                        );


                    box.className =
                        "foster-confirm";


                    // Title

                    const heading =
                        document.createElement(
                            "div"
                        );


                    heading.className =
                        "foster-confirm-title";


                    heading.textContent =
                        title;


                    // Message

                    const messageBox =
                        document.createElement(
                            "div"
                        );


                    messageBox.className =
                        "foster-confirm-message";


                    messageBox.textContent =
                        String(message);


                    // Buttons

                    const buttons =
                        document.createElement(
                            "div"
                        );


                    buttons.className =
                        "foster-confirm-buttons";


                    // Cancel

                    const cancelButton =
                        document.createElement(
                            "button"
                        );


                    cancelButton.type =
                        "button";


                    cancelButton.className =
                        "foster-confirm-cancel";


                    cancelButton.textContent =
                        "Cancel";


                    // Confirm

                    const confirmButton =
                        document.createElement(
                            "button"
                        );


                    confirmButton.type =
                        "button";


                    confirmButton.className =
                        "foster-confirm-ok";


                    confirmButton.textContent =
                        "Confirm";


                    // Assemble

                    buttons.appendChild(
                        cancelButton
                    );


                    buttons.appendChild(
                        confirmButton
                    );


                    box.appendChild(
                        heading
                    );


                    box.appendChild(
                        messageBox
                    );


                    box.appendChild(
                        buttons
                    );


                    overlay.appendChild(
                        box
                    );


                    document.body.appendChild(
                        overlay
                    );


                    let finished =
                        false;


                    function finish(
                        result
                    ) {


                        if (finished) {

                            return;

                        }


                        finished =
                            true;


                        overlay.remove();


                        resolve(
                            result
                        );

                    }


                    // Cancel

                    cancelButton.addEventListener(

                        "click",

                        function () {

                            finish(
                                false
                            );

                        }

                    );


                    // Confirm

                    confirmButton.addEventListener(

                        "click",

                        function () {

                            finish(
                                true
                            );

                        }

                    );


                    // Click outside

                    overlay.addEventListener(

                        "click",

                        function (event) {


                            if (
                                event.target ===
                                overlay
                            ) {

                                finish(
                                    false
                                );

                            }

                        }

                    );


                    // Escape key

                    function escapeHandler(
                        event
                    ) {


                        if (
                            event.key ===
                            "Escape"
                        ) {

                            document.removeEventListener(

                                "keydown",

                                escapeHandler

                            );


                            finish(
                                false
                            );

                        }

                    }


                    document.addEventListener(

                        "keydown",

                        escapeHandler

                    );


                    confirmButton.focus();

                }

            );

        };


    // ======================================================
    // READY
    // ======================================================

    console.log(
        "FosterCare Connect global toast system loaded."
    );


})();

/* ============================================================
   FOSTERCARE CONNECT — SHARED INBOX NOTIFICATION BELL
   Injects a notification control into every logged-in dashboard.
   Uses the existing /api/notifications endpoints and the same
   login session as the rest of FosterCare Connect.
   ============================================================ */
(function () {
    'use strict';
    if (window.__fosterInboxInitialized) return;
    window.__fosterInboxInitialized = true;

    const iconBell = '<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>';
    const styles = document.createElement('style');
    styles.id = 'foster-notification-bell-styles';
    styles.textContent = `
      .foster-inbox { position:relative; display:inline-flex; flex:0 0 auto; align-items:center; font-family:Arial,Helvetica,sans-serif; }
      .foster-inbox *, .foster-inbox *::before, .foster-inbox *::after { box-sizing:border-box; }
      .foster-inbox-toggle { border:1px solid rgba(255,255,255,.18); background:rgba(255,255,255,.08); color:#fff; border-radius:10px; width:43px; height:40px; display:inline-flex; align-items:center; justify-content:center; cursor:pointer; position:relative; transition:background .15s ease; }
      .foster-inbox-toggle:hover, .foster-inbox-toggle:focus-visible { background:#4a154b; outline:2px solid transparent; }
      .foster-inbox-count { position:absolute; top:-7px; right:-8px; min-width:19px; height:19px; border-radius:999px; background:#e83d64; color:#fff; border:2px solid #0d1b2a; display:inline-flex; justify-content:center; align-items:center; padding:0 3px; font-size:10px; line-height:1; font-weight:800; }
      .foster-inbox-count[hidden] { display:none; }
      .foster-inbox-panel { position:absolute; top:calc(100% + 12px); right:0; width:min(390px, calc(100vw - 24px)); max-height:min(520px, calc(100vh - 100px)); overflow:hidden; display:flex; flex-direction:column; background:#fff; color:#172034; border:1px solid #dfe3ea; border-radius:12px; box-shadow:0 18px 50px rgba(0,0,0,.28); z-index:2147483600; text-align:left; }
      .foster-inbox-panel[hidden] { display:none; }
      .foster-inbox-heading { padding:15px; display:flex; align-items:center; justify-content:space-between; gap:12px; border-bottom:1px solid #e7e9ef; }
      .foster-inbox-title { margin:0; font-size:16px; font-weight:750; color:#132238; }
      .foster-inbox-mark-all { background:none; color:#4a154b; border:0; padding:6px 4px; font:600 12px Arial,Helvetica,sans-serif; cursor:pointer; }
      .foster-inbox-mark-all:disabled { opacity:.4; cursor:default; }
      .foster-inbox-messages { overflow-y:auto; min-height:75px; max-height:390px; overscroll-behavior:contain; }
      .foster-inbox-notice { margin:0; padding:24px 16px; font-size:13px; color:#64748b; text-align:center; line-height:1.5; }
      .foster-inbox-item { border:0; border-bottom:1px solid #edf0f3; display:block; width:100%; padding:13px 16px; background:#fff; color:#1f2937; text-align:left; cursor:pointer; font:13px/1.45 Arial,Helvetica,sans-serif; }
      .foster-inbox-item:hover, .foster-inbox-item:focus-visible { background:#f4f2f9; outline:none; }
      .foster-inbox-item.unread { background:#f5f0fb; border-left:3px solid #7348ab; padding-left:13px; }
      .foster-inbox-item-text { display:block; white-space:normal; overflow-wrap:anywhere; }
      .foster-inbox-item-meta { display:flex; justify-content:space-between; gap:8px; padding-top:6px; color:#6b7280; font-size:11px; }
      .foster-inbox-unread { color:#6d3c98; font-weight:700; }
      .foster-inbox-footer { border-top:1px solid #eef0f2; font:11px/1.4 Arial,Helvetica,sans-serif; color:#64748b; padding:10px 15px; background:#fcfcfe; }
      @media (max-width:560px) { .foster-inbox-panel { position:fixed; right:12px; top:70px; width:calc(100vw - 24px); max-height:calc(100vh - 85px); } .foster-inbox-toggle { width:38px; height:38px; } }
    `;
    document.head.appendChild(styles);

    function node(tag, className, text) {
        const el = document.createElement(tag);
        if (className) el.className = className;
        if (text !== undefined) el.textContent = text;
        return el;
    }
    function currentPersonId() {
        const id = Number(localStorage.getItem('userId'));
        return Number.isSafeInteger(id) && id > 0 ? id : null;
    }
    function currentRole() {
        return String(localStorage.getItem('userRole') || '').trim().toLowerCase();
    }
    function relativeTime(value) {
        if (!value) return '';
        const when = new Date(value);
        if (Number.isNaN(when.getTime())) return '';
        return when.toLocaleString(undefined, {dateStyle:'medium', timeStyle:'short'});
    }
    async function request(url, options) {
        const response = await fetch(url, {credentials:'same-origin', cache:'no-store', ...(options || {})});
        if (!response.ok) {
            if (response.status === 401) throw new Error('Please log in again to view notifications.');
            if (response.status === 403) throw new Error('Notification access was denied. Please sign in again.');
            throw new Error('Notifications could not be loaded. Please try again.');
        }
        return response.json();
    }
    function isUnread(item) {
        return !(item.IsRead === true || Number(item.IsRead) === 1);
    }
    function tabForNotification(eventType, role) {
        const type = String(eventType || '').toUpperCase();
        if (type === 'REPORT_SUBMITTED') return role === 'social worker' ? 'reports' : null;
        if (type.includes('DOCUMENT')) return role === 'social worker' || role === 'biological parent' ? 'documents' : null;
        if (type.includes('VISIT')) return role === 'biological parent' ? 'children' : 'biological';
        if (type.includes('EVALUATION')) return role === 'foster parent' ? 'profile' : 'parents';
        if (type.startsWith('APPLICATION_')) return role === 'foster parent' ? 'apply' : 'applications';
        if (type.includes('PLACEMENT') || type.startsWith('MANAGER_')) {
            if (role === 'social worker') return 'placements';
            if (role === 'agency manager') return 'oversight';
            if (role === 'foster parent' && (type === 'MANAGER_APPROVED' || type === 'PLACEMENT_APPROVED')) return 'child';
            return null;
        }
        if (type.includes('CHILD')) return role === 'biological parent' ? 'children' : role === 'social worker' ? 'children' : null;
        if (type.includes('STIPEND')) return role === 'foster parent' ? 'stipend' : null;
        return null;
    }
    function openRelevantTab(item) {
        const tab = tabForNotification(item.EventType, currentRole());
        if (!tab) return;
        const expected = "switchTab('" + tab + "'";
        const anchor = Array.from(document.querySelectorAll('a[onclick],button[onclick]'))
            .find(el => (el.getAttribute('onclick') || '').includes(expected));
        if (anchor) anchor.click();
    }

    function start() {
        const emailLabel = document.getElementById('userEmailDisplay');
        const header = emailLabel && emailLabel.closest('header');
        const personId = currentPersonId();
        if (!header || !personId) return;
        const host = emailLabel.closest('.header-user-area') || emailLabel.parentElement.parentElement;
        if (!host || document.getElementById('fosterNotificationBell')) return;
        const wrapper = node('div', 'foster-inbox');
        const bell = node('button', 'foster-inbox-toggle');
        bell.id = 'fosterNotificationBell';
        bell.type = 'button';
        bell.innerHTML = iconBell; // Static trusted SVG, no API strings inserted here.
        bell.title = 'Notifications';
        bell.setAttribute('aria-label', 'Open notifications');
        bell.setAttribute('aria-haspopup', 'dialog');
        bell.setAttribute('aria-expanded', 'false');
        bell.setAttribute('aria-controls', 'fosterNotificationPanel');
        const count = node('span', 'foster-inbox-count');
        count.hidden = true;
        count.setAttribute('aria-hidden','true');
        bell.appendChild(count);
        const panel = node('section', 'foster-inbox-panel');
        panel.id = 'fosterNotificationPanel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', 'Your notifications');
        panel.hidden = true;
        const heading = node('div','foster-inbox-heading');
        heading.appendChild(node('h2','foster-inbox-title','Notifications'));
        const markAll = node('button','foster-inbox-mark-all','Mark all as read');
        markAll.type = 'button';
        markAll.disabled = true;
        heading.appendChild(markAll);
        const messages = node('div','foster-inbox-messages');
        const footer = node('div','foster-inbox-footer','Select a notification to mark it as read and open its section when available.');
        panel.append(heading, messages, footer);
        wrapper.append(bell, panel);
        const logout = host.querySelector('a[href*="login.html"]');
        if (logout) host.insertBefore(wrapper, logout);
        else host.appendChild(wrapper);
        let allItems = [];
        let panelOpen = false;

        function showNotice(message) {
            messages.replaceChildren(node('p','foster-inbox-notice',message));
        }
        function syncBadge(countNum) {
            const value = Math.max(0, Number(countNum) || 0);
            count.hidden = value === 0;
            count.textContent = value > 99 ? '99+' : String(value);
            bell.setAttribute('aria-label', value ? `Notifications, ${value} unread` : 'Notifications, no unread messages');
        }
        async function refreshBadge() {
            try {
                const result = await request(`/api/notifications/${personId}/unread-count`);
                syncBadge(result.count);
            } catch (err) {
                console.warn('[FosterCare notifications]', err.message);
            }
        }
        function renderMessages() {
            messages.replaceChildren();
            if (!allItems.length) {
                showNotice('No notifications yet. New messages will appear here.');
                markAll.disabled = true;
                return;
            }
            markAll.disabled = !allItems.some(isUnread);
            for (const item of allItems) {
                const unread = isUnread(item);
                const button = node('button', 'foster-inbox-item' + (unread ? ' unread' : ''));
                button.type = 'button';
                button.appendChild(node('span','foster-inbox-item-text', String(item.Message || 'New notification')));
                const meta = node('span','foster-inbox-item-meta');
                meta.appendChild(node('span', '', relativeTime(item.CreatedAt)));
                if (unread) meta.appendChild(node('span', 'foster-inbox-unread', 'Unread'));
                button.appendChild(meta);
                button.addEventListener('click', async () => {
                    if (unread) {
                        try {
                            await request(`/api/notifications/${encodeURIComponent(item.NotificationID)}/read`, {method:'PUT'});
                            item.IsRead = true;
                        } catch (err) {
                            showNotice(err.message);
                            return;
                        }
                    }
                    renderMessages();
                    await refreshBadge();
                    closePanel();
                    openRelevantTab(item);
                });
                messages.appendChild(button);
            }
        }
        async function refreshMessages() {
            showNotice('Loading notifications...');
            markAll.disabled = true;
            try {
                const result = await request(`/api/notifications/${personId}`);
                if (!Array.isArray(result)) throw new Error('Unexpected notifications response.');
                allItems = result;
                renderMessages();
                await refreshBadge();
            } catch (err) {
                showNotice(err.message);
            }
        }
        function closePanel() {
            panel.hidden = true;
            panelOpen = false;
            bell.setAttribute('aria-expanded','false');
        }
        bell.addEventListener('click', () => {
            if (panelOpen) { closePanel(); return; }
            panel.hidden = false;
            panelOpen = true;
            bell.setAttribute('aria-expanded','true');
            refreshMessages();
        });
        markAll.addEventListener('click', async () => {
            markAll.disabled = true;
            try {
                await request(`/api/notifications/${personId}/read-all`, {method:'PUT'});
                allItems.forEach(item => { item.IsRead = true; });
                renderMessages();
                await refreshBadge();
            } catch (err) {
                showNotice(err.message);
            }
        });
        document.addEventListener('click', event => {
            if (panelOpen && !wrapper.contains(event.target)) closePanel();
        });
        document.addEventListener('keydown', event => {
            if (panelOpen && event.key === 'Escape') { closePanel(); bell.focus(); }
        });
        refreshBadge();
        const interval = setInterval(() => {
            if (document.visibilityState === 'visible' && currentPersonId() === personId) {
                if (panelOpen) refreshMessages();
                else refreshBadge();
            }
        }, 60000);
        window.addEventListener('pagehide', () => clearInterval(interval), {once:true});
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',start,{once:true});
    else start();
})();

