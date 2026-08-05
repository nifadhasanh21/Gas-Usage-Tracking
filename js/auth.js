document.addEventListener('DOMContentLoaded', async () => {
    const navToggle = document.getElementById('navToggle');
    const navMenu = document.getElementById('navMenu');
    if (navToggle) {
        navToggle.addEventListener('click', () => navMenu.classList.toggle('show'));
    }

    const { data: { session } } = await _supabase.auth.getSession();
    const isAuthPage = window.location.pathname.endsWith('index.html') || window.location.pathname === '/' || window.location.pathname === '';

    if (!session && !isAuthPage) {
        window.location.href = 'index.html';
        return;
    }

    if (session) {
        if (isAuthPage) {
            window.location.href = 'dashboard.html';
            return;
        }

        const { data: profile } = await _supabase
            .from('profiles')
            .select('role')
            .eq('id', session.user.id)
            .maybeSingle();

        const adminSlot = document.getElementById('adminNavSlot');
        if (adminSlot && profile?.role === 'admin') {
            const isAdminPage = window.location.pathname.endsWith('admin.html');
            adminSlot.innerHTML = `<a href="admin.html" class="${isAdminPage ? 'active' : ''}"><i class="fa-solid fa-user-shield"></i> Admin Panel</a>`;
        }

        if (window.location.pathname.endsWith('admin.html') && profile?.role !== 'admin') {
            alert('Access Denied: Admin privileges required.');
            window.location.href = 'dashboard.html';
        }
    }

    // Tab switcher
    const tabLogin = document.getElementById('tabLogin');
    const tabSignup = document.getElementById('tabSignup');
    const loginForm = document.getElementById('loginForm');
    const signupForm = document.getElementById('signupForm');

    if (tabLogin && tabSignup) {
        tabLogin.addEventListener('click', () => {
            tabLogin.classList.add('active');
            tabSignup.classList.remove('active');
            loginForm.classList.remove('hidden');
            signupForm.classList.add('hidden');
        });

        tabSignup.addEventListener('click', () => {
            tabSignup.classList.add('active');
            tabLogin.classList.remove('active');
            signupForm.classList.remove('hidden');
            loginForm.classList.add('hidden');
        });
    }

    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('loginEmail').value.trim();
            const password = document.getElementById('loginPassword').value;

            const { error } = await _supabase.auth.signInWithPassword({ email, password });
            if (error) {
                alert('Sign In Failed: ' + error.message);
            } else {
                window.location.href = 'dashboard.html';
            }
        });
    }

    if (signupForm) {
        signupForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fullName = document.getElementById('signupName').value.trim();
            const email = document.getElementById('signupEmail').value.trim();
            const password = document.getElementById('signupPassword').value;

            const { data, error } = await _supabase.auth.signUp({
                email,
                password,
                options: { data: { full_name: fullName, role: 'user' } }
            });

            if (error) {
                alert('Sign Up Failed: ' + error.message);
            } else if (data.session) {
                alert('Account created successfully!');
                window.location.href = 'dashboard.html';
            } else {
                alert('Sign up successful! You can now Sign In.');
            }
        });
    }

    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
        await _supabase.auth.signOut();
        localStorage.clear();
        window.location.href = 'index.html';
    });
});