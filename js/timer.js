let timerInterval = null;
let currentSession = JSON.parse(localStorage.getItem('gas_active_session')) || null;

document.addEventListener('DOMContentLoaded', () => {
    syncTimerUI();
    document.getElementById('startBtn')?.addEventListener('click', handleStartGas);
    document.getElementById('stopBtn')?.addEventListener('click', handleStopGas);
    
    if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission();
    }
});

async function handleStartGas() {
    const { data: { user } } = await _supabase.auth.getUser();
    if (!user) return alert('Session expired. Please log in.');

    // 1. Live Burner Guard Check
    const { data: activeSessions, error: fetchErr } = await _supabase
        .from('burner_sessions')
        .select('burner_count')
        .eq('status', 'running');

    if (fetchErr) return alert('Availability check failed: ' + fetchErr.message);

    let usedBurners = 0;
    activeSessions?.forEach(s => usedBurners += s.burner_count);
    const selectedBurnerCount = parseInt(document.querySelector('input[name="burnerOption"]:checked').value);

    if (usedBurners >= 2) {
        return alert('Both burners are currently busy!');
    }
    if (usedBurners === 1 && selectedBurnerCount > 1) {
        return alert('Only 1 burner is free! You cannot start 2 burners.');
    }

    // 2. Start Session
    const mealNote = document.getElementById('mealNoteInput')?.value.trim() || 'General Cooking';
    const startTime = new Date().toISOString();

    const { data, error } = await _supabase.from('burner_sessions').insert([{
        user_id: user.id,
        burner_count: selectedBurnerCount,
        meal_note: mealNote,
        start_time: startTime,
        status: 'running'
    }]).select().single();

    if (error) return alert('Start failed: ' + error.message);

    currentSession = data;
    localStorage.setItem('gas_active_session', JSON.stringify(currentSession));
    syncTimerUI();
    if (typeof refreshDashboard === 'function') refreshDashboard();
}

async function handleStopGas() {
    if (!currentSession) return;

    const endTime = new Date().toISOString();
    const durationMinutes = Math.max(0, Math.round((new Date(endTime) - new Date(currentSession.start_time)) / (1000 * 60)));
    const weightedHours = (durationMinutes / 60) * currentSession.burner_count;

    const { error } = await _supabase.from('burner_sessions').update({
        end_time: endTime,
        duration_minutes: durationMinutes,
        weighted_hours: weightedHours.toFixed(2),
        status: 'completed'
    }).eq('id', currentSession.id);

    if (error) return alert('Save failed: ' + error.message);

    clearInterval(timerInterval);
    localStorage.removeItem('gas_active_session');
    currentSession = null;
    document.getElementById('timerDisplay').innerText = "00:00:00";
    syncTimerUI();
    if (typeof refreshDashboard === 'function') refreshDashboard();
}

function syncTimerUI() {
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const selector = document.getElementById('burnerSelector');
    const mealNoteBox = document.getElementById('mealNoteBox');

    if (currentSession) {
        startBtn?.classList.add('hidden');
        selector?.classList.add('hidden');
        mealNoteBox?.classList.add('hidden');
        stopBtn?.classList.remove('hidden');
        if (!timerInterval) timerInterval = setInterval(renderTime, 1000);
    } else {
        startBtn?.classList.remove('hidden');
        selector?.classList.remove('hidden');
        mealNoteBox?.classList.remove('hidden');
        stopBtn?.classList.add('hidden');
        if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    }
}

function renderTime() {
    if (!currentSession) return;
    const seconds = Math.floor((new Date() - new Date(currentSession.start_time)) / 1000);
    
    // Safety Audio & Notification Alert (At 2 Hours)
    if (seconds === 7200) {
        playBeepSound();
        if (Notification.permission === "granted") {
            new Notification("GasTracker Warning", { body: "Cooking duration exceeded 2 hours!" });
        }
    }

    const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
    const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
    const s = String(seconds % 60).padStart(2, '0');
    document.getElementById('timerDisplay').innerText = `${h}:${m}:${s}`;
}

function playBeepSound() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 1.5);
}