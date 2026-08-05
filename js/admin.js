document.addEventListener('DOMContentLoaded', () => {
    fetchLogs();
    document.getElementById('billForm')?.addEventListener('submit', runBillCalculation);
});

async function fetchLogs() {
    const tbody = document.getElementById('masterLogsBody');
    if (!tbody) return;

    const { data } = await _supabase
        .from('burner_sessions')
        .select('*, profiles(full_name)')
        .order('id', { ascending: false });

    if (!data) return;

    tbody.innerHTML = data.map(log => `
        <tr>
            <td>${log.profiles?.full_name || 'N/A'}</td>
            <td>${log.burner_count} Burner</td>
            <td>${new Date(log.start_time).toLocaleTimeString()}</td>
            <td>${log.end_time ? new Date(log.end_time).toLocaleTimeString() : 'Running'}</td>
            <td>${log.status}</td>
            <td>
                <button class="btn btn-danger" style="padding:4px 8px;" onclick="removeLog(${log.id})"><i class="fa-solid fa-trash"></i></button>
            </td>
        </tr>
    `).join('');
}

async function removeLog(id) {
    if (confirm('Delete log permanently?')) {
        await _supabase.from('burner_sessions').delete().eq('id', id);
        fetchLogs();
    }
}

async function runBillCalculation(e) {
    e.preventDefault();
    const totalAmount = parseFloat(document.getElementById('totalBillInput').value);

    const { data } = await _supabase
        .from('burner_sessions')
        .select('weighted_hours, profiles(full_name)')
        .eq('status', 'completed');

    let houseWeightedTotal = 0;
    const totals = {};

    data.forEach(row => {
        const val = parseFloat(row.weighted_hours || 0);
        const name = row.profiles?.full_name || 'Unknown';
        houseWeightedTotal += val;
        totals[name] = (totals[name] || 0) + val;
    });

    const tbody = document.getElementById('billResultsBody');
    document.getElementById('billResultsContainer').classList.remove('hidden');

    tbody.innerHTML = Object.keys(totals).map(name => {
        const userVal = totals[name];
        const ratio = ((userVal / houseWeightedTotal) * 100).toFixed(1);
        const due = ((userVal / houseWeightedTotal) * totalAmount).toFixed(2);

        return `
            <tr>
                <td><strong>${name}</strong></td>
                <td>${userVal.toFixed(2)} hrs</td>
                <td>${ratio}%</td>
                <td><strong style="color:var(--success);">$${due}</strong></td>
            </tr>
        `;
    }).join('');
}