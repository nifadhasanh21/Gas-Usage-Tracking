let chartInstance = null;
let currentRole = 'user';
let processedReportData = []; // PDF Export Cache
let activeTimers = {}; // Local active timer intervals

// Initialize App on DOM Load
document.addEventListener('DOMContentLoaded', async () => {
    await checkUserRole();
    await registerServiceWorker();
    await requestNotificationPermission();
    
    // Initial Data Fetch
    refreshDashboard();

    // Supabase Single Realtime Listener
    setupRealtimeSync();

    // Event Listeners
    document.getElementById('scanQrBtn')?.addEventListener('click', initQRScanner);
    document.getElementById('downloadPdfBtn')?.addEventListener('click', generateCleanPDFReport);
});

// ==========================================
// Service Worker Registration for PWA
// ==========================================
async function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        try {
            await navigator.serviceWorker.register('/sw.js');
        } catch (err) {
            console.log('SW Registration failed:', err);
        }
    }
}

// ==========================================
// User Authentication & Role Management
// ==========================================
async function checkUserRole() {
    const { data: { user } } = await _supabase.auth.getUser();
    if (user) {
        const { data } = await _supabase.from('profiles').select('role').eq('id', user.id).single();
        if (data) currentRole = data.role;
    }
}

// ==========================================
// PWA & Cross-Browser Notification System
// ==========================================
async function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        await Notification.requestPermission();
    }
}

async function sendGasNotification(title, body) {
    if (!('Notification' in window) || Notification.permission !== 'granted') {
        return;
    }

    const notificationOptions = {
        body: body,
        icon: 'https://cdn-icons-png.flaticon.com/512/785/785116.png',
        badge: 'https://cdn-icons-png.flaticon.com/512/785/785116.png',
        vibrate: [200, 100, 200],
        tag: 'gas-tracker-alert',
        renotify: true
    };

    // Priority 1: Service Worker Message (Cross-Browser & Mobile Support)
    if ('serviceWorker' in navigator) {
        try {
            const reg = await navigator.serviceWorker.ready;
            if (reg.active) {
                reg.active.postMessage({
                    type: 'SHOW_NOTIFICATION',
                    title: title,
                    options: notificationOptions
                });
                return;
            }
        } catch (err) {
            console.log('SW postMessage failed, falling back to showNotification:', err);
        }

        try {
            const reg = await navigator.serviceWorker.ready;
            if (reg && reg.showNotification) {
                await reg.showNotification(title, notificationOptions);
                return;
            }
        } catch (err) {
            console.log('Service Worker notification fallback failed:', err);
        }
    }

    // Priority 2: Standard Desktop / In-Tab Notification Fallback
    try {
        new Notification(title, notificationOptions);
    } catch (e) {
        console.log('Standard Notification error:', e);
    }
}

// ==========================================
// Realtime Database Subscription
// ==========================================
function setupRealtimeSync() {
    _supabase
        .channel('realtime-burner-changes')
        .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'burner_sessions' },
            (payload) => {
                refreshDashboard();

                if (payload.eventType === 'INSERT') {
                    const burnerNum = payload.new.burner_count || payload.new.burner_index || 1;
                    sendGasNotification(
                        '🔥 Stove Turned ON!',
                        `New cooking session started on Burner ${burnerNum}.`
                    );
                } 
                else if (payload.eventType === 'UPDATE' && payload.new.status === 'completed') {
                    sendGasNotification(
                        '✅ Stove Turned OFF!',
                        `Cooking session completed (${payload.new.duration_minutes || 0} mins).`
                    );
                }
            }
        )
        .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'app_settings' },
            () => {
                fetchDateWiseUsageAndCost();
            }
        )
        .subscribe();
}

// ==========================================
// Dashboard Logic & Data Fetching
// ==========================================
function refreshDashboard() {
    fetchLiveStatusAndQueue();
    fetchDateWiseUsageAndCost();
}

async function fetchLiveStatusAndQueue() {
    const grid = document.getElementById('burnerStatusGrid');
    const feed = document.getElementById('liveCookingFeed');
    const queueBox = document.getElementById('queueControls');

    const { data: { user } } = await _supabase.auth.getUser();

    // Get running sessions
    const { data: activeSessions } = await _supabase
        .from('burner_sessions')
        .select('*, profiles(full_name)')
        .eq('status', 'running');

    // Clear old active timers
    Object.keys(activeTimers).forEach(id => clearInterval(activeTimers[id]));
    activeTimers = {};

    let b1Session = activeSessions?.find(s => (s.burner_count || s.burner_index) === 1);
    let b2Session = activeSessions?.find(s => (s.burner_count || s.burner_index) === 2);

    // Render Dual Burner Control Cards
    if (grid) {
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(280px, 1fr))';
        grid.style.gap = '15px';

        grid.innerHTML = [1, 2].map(bIndex => {
            const session = bIndex === 1 ? b1Session : b2Session;
            const isBusy = !!session;
            const isOwner = session && user && session.user_id === user.id;

            return `
                <div class="card" style="border: 1px solid ${isBusy ? '#ef4444' : '#22c55e'}; background: #fafafa; padding: 15px; border-radius: 10px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                        <h4 style="margin:0;"><i class="fa-solid fa-fire"></i> Burner ${bIndex}</h4>
                        <span style="background:${isBusy ? '#fee2e2' : '#dcfce7'}; color:${isBusy ? '#991b1b' : '#166534'}; padding:3px 8px; border-radius:12px; font-size:0.8rem; font-weight:bold;">
                            ${isBusy ? 'BUSY' : 'FREE'}
                        </span>
                    </div>

                    ${isBusy ? `
                        <div style="margin-bottom:10px;">
                            <p style="margin:2px 0;"><strong>User:</strong> ${session.profiles?.full_name || 'Member'}</p>
                            <p style="margin:2px 0;"><strong>Item:</strong> ${session.meal_note || 'General Cooking'}</p>
                            <h2 style="margin:10px 0 5px 0; font-family:monospace;" id="timer_b${bIndex}">00:00:00</h2>
                        </div>
                        ${(isOwner || currentRole === 'admin') ? `
                            <button id="btn_stop_b${bIndex}" onclick="stopCookingSession(${session.id}, ${bIndex}, '${session.start_time}')" class="btn-ice btn-danger-ice" style="width:100%;"><i class="fa-solid fa-square"></i> Stop Cooking</button>
                        ` : `<p style="font-size:0.8rem; color:#666; margin:0;">In use by another member</p>`}
                    ` : `
                        <div>
                            <input type="text" id="mealNote_b${bIndex}" class="input-glass" placeholder="What are you cooking?" style="width:100%; padding:8px; margin-bottom:10px; border:1px solid #ccc; border-radius:6px;">
                            <button id="btn_start_b${bIndex}" onclick="startCookingSession(${bIndex})" class="btn-ice" style="width:100%;"><i class="fa-solid fa-play"></i> Start Cooking</button>
                        </div>
                    `}
                </div>
            `;
        }).join('');

        // Live Timers Setup
        activeSessions?.forEach(s => {
            const bIndex = s.burner_count || s.burner_index || 1;
            const timerElem = document.getElementById(`timer_b${bIndex}`);
            if (timerElem) {
                const startTime = new Date(s.start_time).getTime();
                activeTimers[s.id] = setInterval(() => {
                    const now = new Date().getTime();
                    const diff = Math.max(0, Math.floor((now - startTime) / 1000));
                    const hrs = String(Math.floor(diff / 3600)).padStart(2, '0');
                    const mins = String(Math.floor((diff % 3600) / 60)).padStart(2, '0');
                    const secs = String(diff % 60).padStart(2, '0');
                    timerElem.innerText = `${hrs}:${mins}:${secs}`;
                }, 1000);
            }
        });
    }

    if (feed) {
        if (!activeSessions || activeSessions.length === 0) {
            feed.innerHTML = `<p class="subtitle text-center" style="color:var(--badge-green-text, #166534);"><i class="fa-solid fa-circle-check"></i> All burners are currently free.</p>`;
        } else {
            feed.innerHTML = activeSessions.map(s => `
                <div class="input-glass mb-2" style="display:flex; justify-content:space-between; align-items:center; padding: 10px; border-radius: 8px; background:#fff; border:1px solid #e4e4e7;">
                    <span><i class="fa-solid fa-fire"></i> <strong>${s.profiles?.full_name || 'User'}</strong> is cooking <em>${s.meal_note || 'N/A'}</em> on Burner ${s.burner_count || s.burner_index || 1}</span>
                    ${currentRole === 'admin' ? `<button onclick="emergencyForceStop(${s.id})" class="btn-ice btn-danger-ice" style="padding: 4px 10px; font-size: 0.75rem;"><i class="fa-solid fa-power-off"></i> Force Stop</button>` : ''}
                </div>
            `).join('');
        }
    }

    if (queueBox) {
        if (b1Session && b2Session) {
            queueBox.innerHTML = `<button onclick="joinQueue('${user?.id}')" class="btn-ice"><i class="fa-solid fa-clock"></i> Both Burners Busy - Join Queue</button>`;
        } else {
            queueBox.innerHTML = '';
        }
    }
}

// Start Cooking Action
async function startCookingSession(burnerIndex) {
    const { data: { user } } = await _supabase.auth.getUser();
    if (!user) return alert('Please login first!');

    const btn = document.getElementById(`btn_start_b${burnerIndex}`);
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Starting...`;
    }

    const noteInput = document.getElementById(`mealNote_b${burnerIndex}`);
    const mealNote = noteInput?.value.trim() || 'General Cooking';

    const { error } = await _supabase.from('burner_sessions').insert([{
        user_id: user.id,
        burner_count: burnerIndex,
        meal_note: mealNote,
        start_time: new Date().toISOString(),
        status: 'running'
    }]);

    if (error) {
        alert('Failed to start burner: ' + error.message);
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-play"></i> Start Cooking`;
        }
    } else {
        refreshDashboard();
    }
}

// Stop Cooking Action
async function stopCookingSession(sessionId, burnerIndex, startTimeIso) {
    const btn = document.getElementById(`btn_stop_b${burnerIndex}`);
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Stopping...`;
    }

    const endTime = new Date();
    const startTime = new Date(startTimeIso);
    const durationMinutes = Math.max(1, Math.round((endTime - startTime) / (1000 * 60)));
    const weightedHours = (durationMinutes / 60);

    const { error } = await _supabase.from('burner_sessions').update({
        end_time: endTime.toISOString(),
        duration_minutes: durationMinutes,
        weighted_hours: weightedHours,
        status: 'completed'
    }).eq('id', sessionId);

    if (error) {
        alert('Failed to stop session: ' + error.message);
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-square"></i> Stop Cooking`;
        }
    } else {
        refreshDashboard();
    }
}

async function emergencyForceStop(sessionId) {
    if (!confirm('Are you sure you want to force shut down this active burner session?')) return;
    
    const { data: session } = await _supabase.from('burner_sessions').select('start_time').eq('id', sessionId).single();
    const endTime = new Date();
    const startTime = session ? new Date(session.start_time) : endTime;
    const durationMinutes = Math.max(1, Math.round((endTime - startTime) / (1000 * 60)));

    await _supabase.from('burner_sessions').update({
        end_time: endTime.toISOString(),
        duration_minutes: durationMinutes,
        weighted_hours: (durationMinutes / 60),
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

    if (setRes) {
        setRes.forEach(s => {
            if (s.key === 'cylinder_cost' && s.value) cylinderCost = parseFloat(s.value);
            if (s.key === 'cylinder_capacity_hours' && s.value) cylinderCapHours = parseFloat(s.value);
        });
    }

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

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
        const logDate = new Date(row.start_time);
        const dateStr = logDate.toLocaleDateString();
        
        if (!grouped[dateStr]) grouped[dateStr] = [];
        grouped[dateStr].push(row);

        if (logDate.getMonth() === currentMonth && logDate.getFullYear() === currentYear) {
            const mins = parseInt(row.duration_minutes || 0);
            const name = row.profiles?.full_name || 'User';

            if (!userOverallMins[name]) userOverallMins[name] = 0;
            userOverallMins[name] += mins;
            grandTotalMins += mins;
        }
    });

    let html = '';

    for (const dateStr in grouped) {
        const dayLogs = grouped[dateStr];
        let dayMins = 0;

        html += `
            <div class="day-table-card mb-4" style="background:#fff; padding:15px; border-radius:10px; border:1px solid #e4e4e7;">
                <h4 style="color:var(--text-secondary, #4b5563); margin-bottom: 12px;"><i class="fa-regular fa-calendar"></i> Date: ${dateStr}</h4>
                <div class="table-responsive">
                    <table style="width:100%; border-collapse:collapse;">
                        <thead>
                            <tr style="border-bottom:2px solid #e4e4e7; text-align:left;">
                                <th style="padding:8px;">User</th>
                                <th style="padding:8px;">Meal / Item</th>
                                <th style="padding:8px;">Burner</th>
                                <th style="padding:8px;">Duration</th>
                                ${currentRole === 'admin' ? '<th style="text-align:right; padding:8px;">Action</th>' : ''}
                            </tr>
                        </thead>
                        <tbody>
        `;

        dayLogs.forEach(item => {
            const name = item.profiles?.full_name || 'User';
            const mins = parseInt(item.duration_minutes || 0);
            const burnerNum = item.burner_count || item.burner_index || 1;

            dayMins += mins;
            totalWeightedHours += parseFloat(item.weighted_hours || (mins / 60));

            processedReportData.push({
                date: dateStr,
                user: name,
                meal: item.meal_note || 'General Cooking',
                burners: `Burner ${burnerNum}`,
                duration: `${mins} mins`
            });

            html += `
                <tr style="border-bottom:1px solid #f4f4f5;">
                    <td style="padding:8px;"><strong>${name}</strong></td>
                    <td style="padding:8px;">${item.meal_note || 'General Cooking'}</td>
                    <td style="padding:8px;">Burner ${burnerNum}</td>
                    <td style="padding:8px;">${mins} mins</td>
                    ${currentRole === 'admin' ? `
                        <td style="text-align:right; padding:8px;">
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

        chartLabels.unshift(dateStr);
        chartData.unshift(dayMins);
    }

    // Cylinder Percentage calculation
    const usedPct = Math.min(100, (totalWeightedHours / cylinderCapHours) * 100);
    const remainingPct = Math.max(0, 100 - usedPct).toFixed(1);
    
    const pctTextElem = document.getElementById('cylinderPctText');
    const barElem = document.getElementById('cylinderProgressBar');
    if (pctTextElem) pctTextElem.innerText = `${remainingPct}%`;
    if (barElem) barElem.style.width = `${remainingPct}%`;

    // Bill Splitter Calculation
    let costBreakdownHtml = '';
    if (Object.keys(userOverallMins).length === 0) {
        costBreakdownHtml = `<p>No cooking logs for the current month yet.</p>`;
    } else {
        costBreakdownHtml = Object.keys(userOverallMins).map(name => {
            const userMins = userOverallMins[name];
            const percentage = grandTotalMins > 0 ? (userMins / grandTotalMins) : 0;
            const userCost = (percentage * cylinderCost).toFixed(2);
            return `<p style="margin-bottom: 6px;"><strong>${name}</strong>: ${userMins} Mins ➔ Estimated Bill: <strong>${userCost} BDT</strong></p>`;
        }).join('');
    }

    html += `
        <div class="grand-total-box" style="background:#f8fafc; padding:15px; border-radius:10px; border:1px solid #e2e8f0; margin-top:20px;">
            <h4 style="margin-top:0;">Current Month Bill Splitter (Cylinder: ${cylinderCost} BDT)</h4>
            <p class="mb-2">Current Month Total Gas Use: <strong>${grandTotalMins} Minutes</strong></p>
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
                backgroundColor: '#0f172a',
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

// Clean Styled PDF Generation
function generateCleanPDFReport() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("GasTracker - Usage & Bill Summary", 14, 20);

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Generated On: ${new Date().toLocaleDateString()}`, 14, 28);

    const tableBody = processedReportData.map(d => [d.date, d.user, d.meal, d.burners, d.duration]);

    doc.autoTable({
        startY: 35,
        head: [['Date', 'Member', 'Meal Note', 'Burners', 'Duration']],
        body: tableBody,
        theme: 'striped',
        headStyles: { fillColor: [15, 23, 42] },
        styles: { fontSize: 9 }
    });

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
    if (!box) return;
    box.classList.remove('hidden');
    const html5QrcodeScanner = new Html5QrcodeScanner("reader", { fps: 10, qrbox: 250 });
    html5QrcodeScanner.render((decodedText) => {
        alert("Kitchen QR Scanned: " + decodedText);
        html5QrcodeScanner.clear();
        box.classList.add('hidden');
    });
}