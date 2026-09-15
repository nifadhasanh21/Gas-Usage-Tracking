document.addEventListener('DOMContentLoaded', async () => {
    await initCylinderSettings();
    fetchLogs();
    
    const billForm = document.getElementById('billForm');
    if (billForm) {
        billForm.addEventListener('submit', runBillCalculation);
    }

    const finishBtn = document.getElementById('finishCylinderBtn');
    if (finishBtn) {
        finishBtn.addEventListener('click', finishAndStartNewCylinder);
    }

    const saveDateBtn = document.getElementById('saveStartDateBtn');
    if (saveDateBtn) {
        saveDateBtn.addEventListener('click', updateCylinderStartDate);
    }
});

let currentCylinderId = 1;
let currentCylinderStartDate = null;

// ==========================================
// Initialize Cylinder Settings
// ==========================================
async function initCylinderSettings() {
    const { data } = await _supabase.from('app_settings').select('key, value');
    if (data) {
        data.forEach(s => {
            if (s.key === 'current_cylinder_id') currentCylinderId = parseInt(s.value || 1);
            if (s.key === 'current_cylinder_start_date') currentCylinderStartDate = s.value;
            if (s.key === 'cylinder_cost') {
                const billInput = document.getElementById('totalBillInput');
                if (billInput) billInput.value = s.value;
            }
        });
    }

    // যদি তারিখ সেট না থাকে, ডাটাবেজ থেকে সবচেয়ে পুরানো কুকিং লগের তারিখ (যেমন: ৬ আগস্ট) অটো সিলেক্ট হবে
    if (!currentCylinderStartDate) {
        const { data: firstLog } = await _supabase
            .from('burner_sessions')
            .select('start_time')
            .order('start_time', { ascending: true })
            .limit(1)
            .single();

        currentCylinderStartDate = firstLog?.start_time || new Date().toISOString();
        await _supabase.from('app_settings').upsert({ key: 'current_cylinder_start_date', value: currentCylinderStartDate }, { onConflict: 'key' });
    }

    const idDisplay = document.getElementById('currentCylinderIdDisplay');
    const dateDisplay = document.getElementById('currentCylinderStartDate');
    const dateInput = document.getElementById('startDateInput');

    if (idDisplay) idDisplay.innerText = `Cylinder #${currentCylinderId}`;
    if (dateDisplay) dateDisplay.innerText = new Date(currentCylinderStartDate).toLocaleString();
    
    // Set value in datetime-local input (YYYY-MM-DDTHH:mm)
    if (dateInput && currentCylinderStartDate) {
        const dateObj = new Date(currentCylinderStartDate);
        const isoLocal = new Date(dateObj.getTime() - (dateObj.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
        dateInput.value = isoLocal;
    }
}

// ==========================================
// Admin Update Cylinder Start Date Manually
// ==========================================
async function updateCylinderStartDate() {
    const dateInput = document.getElementById('startDateInput');
    if (!dateInput || !dateInput.value) {
        return alert("Please select a valid date and time!");
    }

    const newStartDateIso = new Date(dateInput.value).toISOString();

    const { error } = await _supabase
        .from('app_settings')
        .upsert({ key: 'current_cylinder_start_date', value: newStartDateIso }, { onConflict: 'key' });

    if (error) {
        alert("Failed to update date: " + error.message);
    } else {
        alert("Cylinder start date successfully updated! All old data from this date will now be included.");
        await initCylinderSettings();
        fetchLogs();
    }
}

// ==========================================
// Mark Gas Finished & Start New Cylinder
// ==========================================
async function finishAndStartNewCylinder() {
    if (!confirm("Are you sure the gas cylinder is completely finished?\nThis will lock current calculations and start a NEW cylinder cycle for upcoming cooking logs.")) {
        return;
    }

    const newCylinderId = currentCylinderId + 1;
    const newStartDate = new Date().toISOString();

    await _supabase.from('app_settings').upsert({ key: 'current_cylinder_id', value: newCylinderId.toString() }, { onConflict: 'key' });
    await _supabase.from('app_settings').upsert({ key: 'current_cylinder_start_date', value: newStartDate }, { onConflict: 'key' });

    alert(`Success! Cylinder #${currentCylinderId} completed.\nNow starting Cylinder #${newCylinderId}. All new logs will accumulate for this new cylinder.`);

    await initCylinderSettings();
    fetchLogs();
}

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
            <td>Burner ${log.burner_count || log.burner_index || 1}</td>
            <td>${new Date(log.start_time).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</td>
            <td>${log.end_time ? new Date(log.end_time).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '<span style="color:orange;">Running</span>'}</td>
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
// Edit Cooking Log Duration
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
    }
}

// ==========================================
// Delete Cooking Log
// ==========================================
async function removeLog(id) {
    if (confirm('Delete log permanently?')) {
        const { error } = await _supabase.from('burner_sessions').delete().eq('id', id);
        if (error) {
            alert('Failed to delete log: ' + error.message);
        } else {
            fetchLogs();
        }
    }
}

// ==========================================
// Save Cylinder Bill & Calculate Splitter
// ==========================================
async function runBillCalculation(e) {
    e.preventDefault();
    
    const billInput = document.getElementById('totalBillInput');
    const totalAmount = parseFloat(billInput.value);

    if (isNaN(totalAmount) || totalAmount <= 0) {
        alert("Please enter a valid bill amount!");
        return;
    }

    await _supabase
        .from('app_settings')
        .upsert({ key: 'cylinder_cost', value: totalAmount.toString() }, { onConflict: 'key' });

    // সক্রিয় সিলিন্ডার শুরুর তারিখ বা তার পর থেকে সমস্ত ডাটা তুলে আনবে
    const { data, error } = await _supabase
        .from('burner_sessions')
        .select('start_time, duration_minutes, weighted_hours, profiles(full_name)')
        .eq('status', 'completed')
        .gte('start_time', currentCylinderStartDate);

    if (error) {
        alert("Failed to fetch sessions: " + error.message);
        return;
    }

    let totalHouseMins = 0;
    let houseWeightedTotal = 0;
    const userMins = {};
    const userWeighted = {};

    data?.forEach(row => {
        const mins = parseInt(row.duration_minutes || 0);
        const weighted = parseFloat(row.weighted_hours || (mins / 60));
        const name = row.profiles?.full_name || 'Unknown User';

        totalHouseMins += mins;
        houseWeightedTotal += weighted;

        userMins[name] = (userMins[name] || 0) + mins;
        userWeighted[name] = (userWeighted[name] || 0) + weighted;
    });

    const tbody = document.getElementById('billResultsBody');
    const resultsContainer = document.getElementById('billResultsContainer');
    if (resultsContainer) resultsContainer.classList.remove('hidden');

    if (totalHouseMins === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;">No completed logs recorded for active Cylinder #${currentCylinderId} starting from ${new Date(currentCylinderStartDate).toLocaleDateString()}.</td></tr>`;
        alert(`Bill rate (${totalAmount} BDT) saved!`);
        return;
    }

    tbody.innerHTML = Object.keys(userMins).map(name => {
        const uMins = userMins[name];
        const uWeighted = userWeighted[name];
        const ratio = ((uMins / totalHouseMins) * 100).toFixed(1);
        const due = ((uMins / totalHouseMins) * totalAmount).toFixed(2);

        return `
            <tr>
                <td><strong>${name}</strong></td>
                <td>${uMins} Mins</td>
                <td>${uWeighted.toFixed(2)} hrs</td>
                <td>${ratio}%</td>
                <td><strong style="color:var(--success, #16a34a);">${due} BDT</strong></td>
            </tr>
        `;
    }).join('');

    alert(`Bill updated (${totalAmount} BDT)!`);
}