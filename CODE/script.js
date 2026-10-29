document.addEventListener('DOMContentLoaded', () => {

    const loginForm =
        document.getElementById('loginForm');

    const emailInput =
        document.getElementById('loginEmail');

    const passwordInput =
        document.getElementById('loginPassword');

    const rememberMeCheckbox =
        document.getElementById('rememberMe');

    const messageEl =
        document.getElementById('loginMessage');

    const loginButton =
        loginForm
            ? loginForm.querySelector('button[type="submit"]')
            : null;


    // =========================================================
    // 1. LOAD REMEMBERED EMAIL
    // =========================================================

    const savedEmail =
        localStorage.getItem('rememberedEmail');


    if (savedEmail && emailInput) {

        emailInput.value =
            savedEmail;


        if (rememberMeCheckbox) {

            rememberMeCheckbox.checked =
                true;
        }
    }


    // =========================================================
    // 2. LOGIN FORM
    // =========================================================

    if (loginForm) {

        loginForm.addEventListener(
            'submit',
            async (e) => {

                e.preventDefault();


                const email =
                    emailInput
                        ? emailInput.value.trim().toLowerCase()
                        : '';


                const password =
                    passwordInput
                        ? passwordInput.value
                        : '';


                // Clear old inline message

                if (messageEl) {

                    messageEl.textContent =
                        '';
                }


                // =============================================
                // VALIDATE LOGIN FORM
                // =============================================

                if (!email || !password) {

                    showToast(
                        'Email and password are required.',
                        'error'
                    );

                    return;
                }


                // =============================================
                // DISABLE BUTTON WHILE CHECKING LOGIN
                // =============================================

                if (loginButton) {

                    loginButton.disabled =
                        true;

                    loginButton.textContent =
                        'Signing In...';
                }


                showToast(
                    'Authenticating...',
                    'info',
                    1500
                );


                try {

                    // =========================================
                    // SEND LOGIN REQUEST
                    // =========================================

                    const response =
                        await fetch(
                            '/api/login',
                            {
                                method: 'POST',

                                headers: {
                                    'Content-Type':
                                        'application/json'
                                },

                                body:
                                    JSON.stringify({
                                        email,
                                        password
                                    })
                            }
                        );


                    const data =
                        await response.json();


                    // =========================================
                    // LOGIN SUCCESSFUL
                    // =========================================

                    if (response.ok) {


                        // =====================================
                        // REMEMBER ME
                        // =====================================

                        if (
                            rememberMeCheckbox &&
                            rememberMeCheckbox.checked
                        ) {

                            localStorage.setItem(
                                'rememberedEmail',
                                email
                            );

                        } else {

                            localStorage.removeItem(
                                'rememberedEmail'
                            );
                        }



                        showToast(
                            `Login successful! Welcome, ${data.fullName}`,
                            'success'
                        );


                        // =====================================
                        // SAVE USER INFORMATION
                        //
                        // These exact key names are used by
                        // your dashboard pages.
                        // =====================================

                        localStorage.setItem(
                            'userId',
                            data.personId
                        );


                        localStorage.setItem(
                            'userFullName',
                            data.fullName
                        );


                        localStorage.setItem(
                            'userEmail',
                            data.email
                        );


                        localStorage.setItem(
                            'userRole',
                            data.role
                        );


                        // =====================================
                        // REDIRECT TO CORRECT DASHBOARD
                        // =====================================

                        setTimeout(
                            () => {

                                const role =
                                    data.role
                                        ? data.role.toLowerCase()
                                        : '';


                                if (
                                    role.includes('admin')
                                ) {

                                    window.location.href =
                                        'admin-dashboard.html';


                                } else if (
                                    role.includes(
                                        'social worker'
                                    )
                                ) {

                                    window.location.href =
                                        'socialworker-dashboard.html';


                                } else if (
                                    role.includes(
                                        'foster parent'
                                    )
                                ) {

                                    window.location.href =
                                        'fosterparent-dashboard.html';


                                } else if (
                                    role.includes('clerk')
                                ) {

                                    window.location.href =
                                        'clerk-dashboard.html';


                                } else if (
                                    role.includes('manager')
                                ) {

                                    window.location.href =
                                        'agencymanager-dashboard.html';


                                } else {

                                    window.location.href =
                                        'biologicalparent-dashboard.html';
                                }

                            },
                            1000
                        );


                        return;
                    }


                    // =========================================
                    // NORMAL LOGIN ERROR
                    // =========================================

                    showToast(
                        data.error ||
                        'Invalid email or password.',
                        'error'
                    );


                    if (messageEl) {

                        messageEl.style.color =
                            '#c92a2a';


                        messageEl.textContent =
                            data.error ||
                            'Invalid email or password.';
                    }


                    // Re-enable button

                    if (loginButton) {

                        loginButton.disabled =
                            false;


                        loginButton.textContent =
                            'Sign In';
                    }


                } catch (err) {

                    console.error(
                        'Login error:',
                        err
                    );


                    showToast(
                        'Server connection failed. Try again later.',
                        'error'
                    );


                    if (messageEl) {

                        messageEl.style.color =
                            '#c92a2a';


                        messageEl.textContent =
                            'Server connection failed. Try again later.';
                    }


                    if (loginButton) {

                        loginButton.disabled =
                            false;


                        loginButton.textContent =
                            'Sign In';
                    }
                }
            }
        );
    }
});


/**
 * Displays a non-blocking toast notification.
 *
 * @param {string} message
 * The text to display.
 *
 * @param {string} type
 * 'success', 'error', or 'info'.
 *
 * @param {number} duration
 * Time in milliseconds before the toast disappears.
 */

function showToast(
    message,
    type = 'info',
    duration = 3000
) {

    // =========================================================
    // ENSURE TOAST CONTAINER EXISTS
    // =========================================================

    let container =
        document.getElementById(
            'toast-container'
        );


    if (!container) {

        container =
            document.createElement('div');


        container.id =
            'toast-container';


        document.body.appendChild(
            container
        );
    }


    // =========================================================
    // CREATE TOAST
    // =========================================================

    const toast =
        document.createElement('div');


    toast.className =
        `toast ${type}`;


    const msgSpan =
        document.createElement('span');


    msgSpan.className =
        'toast-message';


    msgSpan.textContent =
        message;


    const closeBtn =
        document.createElement('button');


    closeBtn.className =
        'toast-close';


    closeBtn.innerHTML =
        '&times;';


    closeBtn.onclick =
        () => removeToast(toast);


    toast.appendChild(
        msgSpan
    );


    toast.appendChild(
        closeBtn
    );


    container.appendChild(
        toast
    );


    // =========================================================
    // FADE IN
    // =========================================================

    setTimeout(
        () => {

            toast.classList.add(
                'show'
            );

        },
        10
    );


    // =========================================================
    // AUTO REMOVE
    // =========================================================

    const timer =
        setTimeout(
            () => {

                removeToast(
                    toast
                );

            },
            duration
        );


    // =========================================================
    // REMOVE TOAST
    // =========================================================

    function removeToast(el) {

        clearTimeout(
            timer
        );


        el.classList.remove(
            'show'
        );


        setTimeout(
            () => {

                if (el.parentElement) {

                    el.parentElement.removeChild(
                        el
                    );
                }

            },
            300
        );
    }
}
