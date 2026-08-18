document.addEventListener('DOMContentLoaded', () => {
    fetchLogs();
    
    // ফর্ম সাবমিট ইভেন্ট হ্যান্ডলার
    const billForm = document.getElementById('billForm');
    if (billForm) {
        billForm.addEventListener('submit', runBillCalculation);
    }
});

// ==========================================
// Fetch Master Cooking Logs
// ==========================================
async function fetchLogs() {
    const tbody = document.getElementById('masterLogsBody');
    if (!tbody) return;

    const { data, error } = await _supabase
        .from('burner_sessions')
        .select('*, profiles(full_name)')
        .order('id', { ascending: false });

    if (error) {
        console.error("Error fetching logs:", error.message);
        return;
    }

    if (!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;">No cooking logs found.</td></tr>`;
        return;
    }

    tbody.innerHTML = data.map(log => `
        <tr>
            <td><strong>${log.profiles?.full_name || 'N/A'}</strong></td>
            <td>${log.burner_count || 1} Burner</td>
            <td>${new Date(log.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
            <td>${log.end_time ? new Date(log.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '<span style="color:orange;">Running</span>'}</td>
            <td><span class="badge">${log.duration_minutes || 0} mins</span></td>
            <td>
                <button class="btn btn-primary" style="padding:4px 8px; font-size:0.8rem; margin-right:4px;" onclick="editLogDuration(${log.id}, ${log.duration_minutes || 0})">
                    <i class="fa-solid fa-pen-to-square"></i> Edit
                </button>
                <button class="btn btn-danger" style="padding:4px 8px; font-size:0.8rem;" onclick="removeLog(${log.id})">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

// ==========================================
// Edit Cooking Log Duration (Admin Only)
// ==========================================
async function editLogDuration(id, currentMins) {
    const newMinsInput = prompt(`Edit Cooking Duration (Minutes):\nCurrent: ${currentMins} mins`, currentMins);
    if (newMinsInput === null) return;

    const newMins = parseInt(newMinsInput, 10);
    if (isNaN(newMins) || newMins < 0) {
        return alert('Please enter a valid number of minutes.');
    }

    const newWeightedHours = parseFloat((newMins / 60).toFixed(4));

    const { error } = await _supabase
        .from('burner_sessions')
        .update({
            duration_minutes: newMins,
            weighted_hours: newWeightedHours
        })
        .eq('id', id);

    if (error) {
        alert('Failed to update duration: ' + error.message);
    } else {
        alert('Updated successfully!');
        fetchLogs();
        if (typeof refreshDashboard === 'function') refreshDashboard();
    }
}

// ==========================================
// Delete Cooking Log Permanently
// ==========================================
async function removeLog(id) {
    if (confirm('Delete log permanently?')) {
        const { error } = await _supabase.from('burner_sessions').delete().eq('id', id);
        if (error) {
            alert('Failed to delete log: ' + error.message);
        } else {
            fetchLogs();
            if (typeof refreshDashboard === 'function') refreshDashboard();
        }
    }
}

// ==========================================
// Save Cylinder Bill & Run Dynamic Splitter
// ==========================================
async function runBillCalculation(e) {
    e.preventDefault();
    
    const billInput = document.getElementById('totalBillInput');
    const totalAmount = parseFloat(billInput.value);

    if (isNaN(totalAmount) || totalAmount <= 0) {
        alert("Please enter a valid bill amount!");
        return;
    }

    // ১. নতুন টাকা Supabase-এর app_settings টেবিলে আপডেট করবে
    const { error: setErr } = await _supabase
        .from('app_settings')
        .upsert({ key: 'cylinder_cost', value: totalAmount.toString() }, { onConflict: 'key' });

    if (setErr) {
        console.error("Error updating settings:", setErr.message);
        alert("Database update failed! Check permissions.");
        return;
    }

    // ২. শুধুমাত্র চলতি মাসের রান্না সেশনের ডাটা ফেচ করবে
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const { data, error } = await _supabase
        .from('burner_sessions')
        .select('start_time, weighted_hours, profiles(full_name)')
        .eq('status', 'completed');

    if (error) {
        alert("Failed to fetch sessions: " + error.message);
        return;
    }

    let houseWeightedTotal = 0;
    const totals = {};

    data?.forEach(row => {
        const logDate = new Date(row.start_time);
        
        // চলতি মাসের ডাটা ফিল্টারিং
        if (logDate.getMonth() === currentMonth && logDate.getFullYear() === currentYear) {
            const val = parseFloat(row.weighted_hours || 0);
            const name = row.profiles?.full_name || 'Unknown';
            houseWeightedTotal += val;
            totals[name] = (totals[name] || 0) + val;
        }
    });

    const tbody = document.getElementById('billResultsBody');
    const resultsContainer = document.getElementById('billResultsContainer');
    if (resultsContainer) resultsContainer.classList.remove('hidden');

    if (houseWeightedTotal === 0 || Object.keys(totals).length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;">No completed logs for the current month yet.</td></tr>`;
        alert(`Bill rate (${totalAmount} BDT) saved! But no usage logs were found for this month.`);
        return;
    }

    // ৩. UI-তে মেম্বারদের টাকার হিসেব দেখাবে
    tbody.innerHTML = Object.keys(totals).map(name => {
        const userVal = totals[name];
        const ratio = ((userVal / houseWeightedTotal) * 100).toFixed(1);
        const due = ((userVal / houseWeightedTotal) * totalAmount).toFixed(2);

        return `
            <tr>
                <td><strong>${name}</strong></td>
                <td>${userVal.toFixed(2)} hrs</td>
                <td>${ratio}%</td>
                <td><strong style="color:var(--success);">${due} BDT</strong></td>
            </tr>
        `;
    }).join('');

    alert(`Successfully updated gas bill to ${totalAmount} BDT! User dashboard updated.`);

    // ড্যাশবোর্ড স্ক্রিন খোলা থাকলে তা অটো-রিফ্রেশ করবে
    if (typeof refreshDashboard === 'function') {
        refreshDashboard();
    }
}