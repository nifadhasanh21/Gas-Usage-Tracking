document.addEventListener('DOMContentLoaded', async () => {
    loadUserProfileAndStats();

    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
        await _supabase.auth.signOut();
        window.location.href = 'index.html';
    });
});

async function loadUserProfileAndStats() {
    // 1. Get Logged-in User
    const { data: { user }, error: authErr } = await _supabase.auth.getUser();
    if (authErr || !user) {
        window.location.href = 'index.html';
        return;
    }

    // 2. Fetch Profile Info
    const { data: profile } = await _supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

    const name = profile?.full_name || 'User';
    const email = user.email || 'N/A';
    const role = profile?.role || 'user';

    document.getElementById('userName').innerText = name;
    document.getElementById('userEmail').innerText = email;
    document.getElementById('avatarInitial').innerText = name.charAt(0).toUpperCase();
    
    if (role === 'admin') {
        document.getElementById('userRoleBadge').innerHTML = `<span class="burner-badge badge-busy" style="padding: 4px 12px; font-size: 0.75rem;">ADMIN</span>`;
    }

    // 3. Fetch App Settings for Cylinder Cost Calculations
    const { data: setRes } = await _supabase.from('app_settings').select('key, value');
    let cylinderCost = 1450;

    setRes?.forEach(s => {
        if (s.key === 'cylinder_cost') cylinderCost = parseFloat(s.value);
    });

    // 4. Fetch All Sessions for Ratio-based Cost Calculation
    const { data: allSessions } = await _supabase
        .from('burner_sessions')
        .select('*')
        .eq('status', 'completed');

    let grandTotalMins = 0;
    let myTotalMins = 0;
    let mySessions = [];

    allSessions?.forEach(s => {
        const duration = parseInt(s.duration_minutes || 0);
        grandTotalMins += duration;

        if (s.user_id === user.id) {
            myTotalMins += duration;
            mySessions.push(s);
        }
    });

    // Calculate Personal Estimated Cost
    const myCostPercentage = grandTotalMins > 0 ? (myTotalMins / grandTotalMins) : 0;
    const myEstimatedCost = (myCostPercentage * cylinderCost).toFixed(2);

    document.getElementById('totalUserMins').innerText = `${myTotalMins} Mins`;
    document.getElementById('totalUserCost').innerText = `${myEstimatedCost} BDT`;

    // 5. Render History Table
    const tbody = document.getElementById('myHistoryTableBody');
    if (mySessions.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center">No cooking history found yet.</td></tr>`;
        return;
    }

    tbody.innerHTML = mySessions.map(s => {
        const dateStr = new Date(s.start_time).toLocaleDateString();
        return `
            <tr>
                <td><strong>${dateStr}</strong></td>
                <td>${s.meal_note || 'General Cooking'}</td>
                <td>${s.burner_count} Burner(s)</td>
                <td>${parseInt(s.duration_minutes || 0)} mins</td>
            </tr>
        `;
    }).join('');
}