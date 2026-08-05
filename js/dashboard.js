let chartInstance = null;
let currentRole = 'user';
let processedReportData = []; // PDF Export Cache

document.addEventListener('DOMContentLoaded', async () => {
    await checkUserRole();
    refreshDashboard();

    _supabase.channel('public:burner_sessions')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'burner_sessions' }, () => refreshDashboard())
        .subscribe();

    document.getElementById('scanQrBtn')?.addEventListener('click', initQRScanner);
    document.getElementById('downloadPdfBtn')?.addEventListener('click', generateCleanPDFReport);
});

async function checkUserRole() {
    const { data: { user } } = await _supabase.auth.getUser();
    if (user) {
        const { data } = await _supabase.from('profiles').select('role').eq('id', user.id).single();
        if (data) currentRole = data.role;
    }
}

function refreshDashboard() {
    fetchLiveStatusAndQueue();
    fetchDateWiseUsageAndCost();
}

async function fetchLiveStatusAndQueue() {
    const grid = document.getElementById('burnerStatusGrid');
    const feed = document.getElementById('liveCookingFeed');
    const queueBox = document.getElementById('queueControls');

    const { data: activeSessions } = await _supabase
        .from('burner_sessions')
        .select('*, profiles(full_name)')
        .eq('status', 'running');

    let usedBurners = 0;
    activeSessions?.forEach(s => usedBurners += s.burner_count);

    grid.innerHTML = `
        <div class="burner-badge ${usedBurners < 1 ? 'badge-free' : 'badge-busy'}">
            Burner 1: <strong>${usedBurners < 1 ? 'FREE' : 'BUSY'}</strong>
        </div>
        <div class="burner-badge ${usedBurners < 2 ? 'badge-free' : 'badge-busy'}">
            Burner 2: <strong>${usedBurners < 2 ? 'FREE' : 'BUSY'}</strong>
        </div>
    `;

    if (!activeSessions || activeSessions.length === 0) {
        feed.innerHTML = `<p class="subtitle text-center" style="color:var(--badge-green-text);"><i class="fa-solid fa-circle-check"></i> All burners are currently free.</p>`;
    } else {
        feed.innerHTML = activeSessions.map(s => `
            <div class="input-glass mb-4" style="display:flex; justify-content:space-between; align-items:center;">
                <span><i class="fa-solid fa-fire"></i> <strong>${s.profiles?.full_name}</strong>: <em>${s.meal_note || 'N/A'}</em> (${s.burner_count} burner)</span>
                <button onclick="emergencyForceStop(${s.id})" class="btn-ice btn-danger-ice" style="padding: 4px 10px; font-size: 0.75rem;"><i class="fa-solid fa-power-off"></i> Force Stop</button>
            </div>
        `).join('');
    }

    if (usedBurners >= 2) {
        const { data: user } = await _supabase.auth.getUser();
        queueBox.innerHTML = `<button onclick="joinQueue('${user.user?.id}')" class="btn-ice"><i class="fa-solid fa-clock"></i> Both Busy - Join Queue</button>`;
    } else {
        queueBox.innerHTML = '';
    }
}

async function emergencyForceStop(sessionId) {
    if (!confirm('Are you sure you want to force shut down this active burner session?')) return;
    
    const endTime = new Date().toISOString();
    await _supabase.from('burner_sessions').update({
        end_time: endTime,
        status: 'completed'
    }).eq('id', sessionId);

    refreshDashboard();
}

async function joinQueue(userId) {
    if (!userId) return;
    await _supabase.from('burner_queue').insert([{ user_id: userId }]);
    alert('You have joined the queue!');
}

async function fetchDateWiseUsageAndCost() {
    const container = document.getElementById('dateWiseTablesContainer');
    if (!container) return;

    const { data: setRes } = await _supabase.from('app_settings').select('key, value');
    let cylinderCost = 1450;
    let cylinderCapHours = 80;

    setRes?.forEach(s => {
        if (s.key === 'cylinder_cost') cylinderCost = parseFloat(s.value);
        if (s.key === 'cylinder_capacity_hours') cylinderCapHours = parseFloat(s.value);
    });

    const { data } = await _supabase
        .from('burner_sessions')
        .select('*, profiles(full_name)')
        .eq('status', 'completed')
        .order('start_time', { ascending: false });

    if (!data || data.length === 0) {
        container.innerHTML = `<p class="subtitle text-center">No logs found.</p>`;
        return;
    }

    const grouped = {};
    let grandTotalMins = 0;
    let totalWeightedHours = 0;
    let userOverallMins = {};
    let chartLabels = [];
    let chartData = [];
    processedReportData = [];

    data.forEach(row => {
        const dateStr = new Date(row.start_time).toLocaleDateString();
        if (!grouped[dateStr]) grouped[dateStr] = [];
        grouped[dateStr].push(row);
    });

    let html = '';

    for (const dateStr in grouped) {
        const dayLogs = grouped[dateStr];
        let dayMins = 0;

        html += `
            <div class="day-table-card">
                <h4 style="color:var(--text-secondary); margin-bottom: 12px;"><i class="fa-regular fa-calendar"></i> Date: ${dateStr}</h4>
                <div class="table-responsive">
                    <table>
                        <thead>
                            <tr>
                                <th>User</th>
                                <th>Meal / Item</th>
                                <th>Burners Used</th>
                                <th>Duration</th>
                                ${currentRole === 'admin' ? '<th style="text-align:right;">Action</th>' : ''}
                            </tr>
                        </thead>
                        <tbody>
        `;

        dayLogs.forEach(item => {
            const name = item.profiles?.full_name || 'User';
            const mins = parseInt(item.duration_minutes || 0);

            if (!userOverallMins[name]) userOverallMins[name] = 0;
            userOverallMins[name] += mins;

            dayMins += mins;
            totalWeightedHours += parseFloat(item.weighted_hours || 0);

            processedReportData.push({
                date: dateStr,
                user: name,
                meal: item.meal_note || 'General Cooking',
                burners: `${item.burner_count} Burner(s)`,
                duration: `${mins} mins`
            });

            html += `
                <tr>
                    <td><strong>${name}</strong></td>
                    <td>${item.meal_note || 'General Cooking'}</td>
                    <td>${item.burner_count} Burner(s)</td>
                    <td>${mins} mins</td>
                    ${currentRole === 'admin' ? `
                        <td style="text-align:right;">
                            <button onclick="deleteSessionLog(${item.id})" class="btn-ice btn-danger-ice" style="padding: 4px 8px; font-size: 0.75rem;"><i class="fa-solid fa-trash"></i></button>
                        </td>
                    ` : ''}
                </tr>
            `;
        });

        html += `
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        grandTotalMins += dayMins;
        chartLabels.unshift(dateStr);
        chartData.unshift(dayMins);
    }

    // Cylinder Remaining Percentage Logic
    const usedPct = Math.min(100, (totalWeightedHours / cylinderCapHours) * 100);
    const remainingPct = Math.max(0, 100 - usedPct).toFixed(1);
    
    document.getElementById('cylinderPctText').innerText = `${remainingPct}%`;
    document.getElementById('cylinderProgressBar').style.width = `${remainingPct}%`;

    // Cost Splitter
    let costBreakdownHtml = Object.keys(userOverallMins).map(name => {
        const userMins = userOverallMins[name];
        const percentage = grandTotalMins > 0 ? (userMins / grandTotalMins) : 0;
        const userCost = (percentage * cylinderCost).toFixed(2);
        return `<p style="margin-bottom: 6px;"><strong>${name}</strong>: ${userMins} Mins ➔ Estimated Bill: <strong>${userCost} BDT</strong></p>`;
    }).join('');

    html += `
        <div class="grand-total-box">
            <h4>Monthly Gas Bill Splitter (Cylinder: ${cylinderCost} BDT)</h4>
            <p class="mb-4">Total Mess Gas Duration: <strong>${grandTotalMins} Minutes</strong></p>
            <div>${costBreakdownHtml}</div>
        </div>
    `;

    container.innerHTML = html;
    renderAnalyticsChart(chartLabels.slice(-7), chartData.slice(-7));
}

async function deleteSessionLog(sessionId) {
    if (currentRole !== 'admin') return alert('Only admins can delete logs.');
    if (!confirm('Are you sure you want to delete this log?')) return;

    const { error } = await _supabase.from('burner_sessions').delete().eq('id', sessionId);
    if (error) alert('Delete failed: ' + error.message);
    else refreshDashboard();
}

function renderAnalyticsChart(labels, data) {
    const ctx = document.getElementById('usageChart');
    if (!ctx) return;

    if (chartInstance) chartInstance.destroy();

    chartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Gas Used (Minutes)',
                data: data,
                backgroundColor: '#09090b',
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true } }
        }
    });
}

// Clean Styled PDF Generation with jsPDF-AutoTable
function generateCleanPDFReport() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("GasTracker - Usage & Bill Summary", 14, 20);

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Generated On: ${new Date().toLocaleDateString()}`, 14, 28);

    // Build Table Body Data
    const tableBody = processedReportData.map(d => [d.date, d.user, d.meal, d.burners, d.duration]);

    doc.autoTable({
        startY: 35,
        head: [['Date', 'Member', 'Meal Note', 'Burners', 'Duration']],
        body: tableBody,
        theme: 'striped',
        headStyles: { fillColor: [9, 9, 11] },
        styles: { fontSize: 9 }
    });

    // Add Billing Summary Text Below Table
    const finalY = doc.lastAutoTable.finalY + 15;
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Monthly Gas Bill Breakdown", 14, finalY);

    const logsContainer = document.querySelector('.grand-total-box');
    if (logsContainer) {
        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        const lines = doc.splitTextToSize(logsContainer.innerText.replace(/[\r\n]+/g, "\n"), 180);
        doc.text(lines, 14, finalY + 8);
    }

    doc.save(`GasTracker_Report_${new Date().toISOString().slice(0,10)}.pdf`);
}

function initQRScanner() {
    const box = document.getElementById('qrReaderBox');
    box.classList.remove('hidden');
    const html5QrcodeScanner = new Html5QrcodeScanner("reader", { fps: 10, qrbox: 250 });
    html5QrcodeScanner.render((decodedText) => {
        alert("Kitchen QR Scanned: " + decodedText);
        html5QrcodeScanner.clear();
        box.classList.add('hidden');
    });
}

//For Notificaation

// ১. ব্রাউজারে নোটিফিকেশন পারমিশন চাওয়া
async function requestNotificationPermission() {
    if ('Notification' in window) {
        if (Notification.permission === 'default') {
            await Notification.requestPermission();
        }
    }
}

// ২. পুশ নোটিফিকেশন সেন্ড করার ফাংশন
function sendGasNotification(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, {
            body: body,
            icon: 'https://cdn-icons-png.flaticon.com/512/785/785116.png',
            vibrate: [200, 100, 200]
        });
    }
}

// ৩. Supabase Realtime: কেউ চুলা অন বা অফ করলেই নোটিফিকেশন আসবে
document.addEventListener('DOMContentLoaded', () => {
    requestNotificationPermission();

    _supabase
        .channel('realtime-burner-notifications')
        .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'burner_sessions' },
            (payload) => {
                const session = payload.new;
                sendGasNotification(
                    '🔥 Stove Turned ON!',
                    `Someone started cooking on ${session.burner_count} burner(s).`
                );
            }
        )
        .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'burner_sessions' },
            (payload) => {
                const session = payload.new;
                if (session.status === 'completed') {
                    sendGasNotification(
                        '✅ Stove Turned OFF!',
                        `Cooking finished. Duration: ${session.duration_minutes || 0} mins.`
                    );
                }
            }
        )
        .subscribe();
});