/**
 * Escala Storage Service
 * Gerencia o estado e as persistências (Firestore, LocalStorage).
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, collection, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let db;

const EscalaStorage = {
    staff: [],
    freelancers: [],
    schedules: { KIRRA: {}, MUNDAKA: {} },
    periods: [], // Lista de períodos salvos {id, name, start, end}
    activePeriodId: null,
    isSupervisor: false,
    currentDate: new Date(),
    selectedDateISO: null,
    alterations: {}, // Histórico de alterações { staffId: [{date, expires}] }
    rankingResetDate: null,

    async init() {
        if (!window.EscalaConfig || !window.EscalaConfig.firebaseConfig) {
            console.warn("Firebase config not found. Defaulting to empty data.");
            this.staff = [];
            this.schedules = { KIRRA: {}, MUNDAKA: {} };
            this.alterations = {};
            this.rankingResetDate = null;
            window.staff = this.staff;
            window.schedules = this.schedules;
            return;
        }

        try {
            const app = initializeApp(window.EscalaConfig.firebaseConfig);
            db = getFirestore(app);

            // Carrega dados iniciais
            await this.loadInitialData();
            return { success: true };
        } catch (error) {
            console.error("Firebase Init Error:", error);
            // Fallback to local storage or empty data to allow app to run
            this.staff = JSON.parse(localStorage.getItem('escala_fallback_staff') || '[]');
            this.schedules = JSON.parse(localStorage.getItem('escala_fallback_schedules') || '{"KIRRA":{},"MUNDAKA":{}}');
            this.alterations = JSON.parse(localStorage.getItem('escala_alterations_history') || '{}');
            this.rankingResetDate = localStorage.getItem('escala_ranking_reset_date');

            window.staff = this.staff;
            window.schedules = this.schedules;
            return { success: false, error: error.message };
        }
    },

    async loadInitialData() {
        try {
            const staffDoc = await getDoc(doc(db, "settings", "staff"));
            this.staff = staffDoc.exists() ? staffDoc.data().list || [] : [];
            window.staff = this.staff;

            const freelancersDoc = await getDoc(doc(db, "settings", "freelancers"));
            this.freelancers = freelancersDoc.exists() ? freelancersDoc.data().list || [] : [];
            window.freelancers = this.freelancers;

            // Carrega períodos
            const periodsSnapshot = await getDocs(collection(db, "periods"));
            this.periods = [];
            periodsSnapshot.forEach(doc => {
                const data = doc.data();
                if (data) this.periods.push({ id: doc.id, ...data });
            });
            window.periods = this.periods;

            // Carrega escalas individuais (schedules) por equipe
            this.schedules = { KIRRA: {}, MUNDAKA: {} };

            const kirraSnapshot = await getDocs(collection(db, "schedules_KIRRA"));
            kirraSnapshot.forEach(doc => { this.schedules.KIRRA[doc.id] = doc.data(); });

            const mundakaSnapshot = await getDocs(collection(db, "schedules_MUNDAKA"));
            mundakaSnapshot.forEach(doc => { this.schedules.MUNDAKA[doc.id] = doc.data(); });

            window.schedules = this.schedules;

            // Carrega Alterações (Faltas/Penalidades)
            const alterationsDoc = await getDoc(doc(db, "settings", "alterations"));
            this.alterations = alterationsDoc.exists() ? alterationsDoc.data().history || {} : {};

            // Carrega Data de Reset do Ranking
            const rankingDoc = await getDoc(doc(db, "settings", "ranking"));
            this.rankingResetDate = rankingDoc.exists() ? rankingDoc.data().resetDate : null;

            // Save locally as fallback
            localStorage.setItem('escala_fallback_staff', JSON.stringify(this.staff));
            localStorage.setItem('escala_fallback_freelancers', JSON.stringify(this.freelancers));
            localStorage.setItem('escala_fallback_schedules', JSON.stringify(this.schedules));
            localStorage.setItem('escala_fallback_periods', JSON.stringify(this.periods));
            localStorage.setItem('escala_alterations_history', JSON.stringify(this.alterations));
            if (this.rankingResetDate) localStorage.setItem('escala_ranking_reset_date', this.rankingResetDate);

        } catch (error) {
            console.error("Erro DB Load:", error);
            throw error;
        }
    },

    async saveStaff() {
        await setDoc(doc(db, "settings", "staff"), { list: this.staff });
    },

    async saveFreelancers() {
        await setDoc(doc(db, "settings", "freelancers"), { list: this.freelancers });
    },

    async saveSchedule(isoDate, data) {
        // PRIORIDADE: data.team (calculado logicamente por data) > window.activeTeam (aba aberta)
        const team = data.team || window.activeTeam;
        if (!team) throw new Error("Equipe não definida para salvamento.");

        await setDoc(doc(db, `schedules_${team}`, isoDate), data);
        this.schedules[team][isoDate] = data;
    },

    async savePeriod(period) {
        const id = period.id || Date.now().toString();
        const periodData = { name: period.name, start: period.start, end: period.end };
        await setDoc(doc(db, "periods", id), periodData);

        const idx = this.periods.findIndex(p => p.id === id);
        if (idx >= 0) this.periods[idx] = { id, ...periodData };
        else this.periods.push({ id, ...periodData });

        window.periods = this.periods;
        return id;
    },

    async deletePeriod(id) {
        try {
            await deleteDoc(doc(db, "periods", id));
            this.periods = this.periods.filter(p => p.id !== id);
            window.periods = this.periods;
        } catch (e) {
            console.error("Erro ao deletar período:", e);
            throw e;
        }
    },

    async deleteSchedule(team, isoDate) {
        try {
            await deleteDoc(doc(db, `schedules_${team}`, isoDate));
            if (this.schedules[team]) delete this.schedules[team][isoDate];
        } catch (e) {
            console.error(`Erro ao deletar escala ${team}/${isoDate}:`, e);
            throw e;
        }
    },

    async batchDeleteSchedules(team, startIso, endIso) {
        const schedules = this.schedules[team] || {};
        const datesToDelete = Object.keys(schedules).filter(d => d >= startIso && d <= endIso);
        
        for (const iso of datesToDelete) {
            await this.deleteSchedule(team, iso);
        }
    },

    async saveAllPeriods(list) {
        // Para simplificar, poderíamos salvar cada um, mas para o Undo, 
        // o mais seguro seria limpar a coleção e resalvar. 
        // Neste sistema simplificado, apenas iteramos:
        for (const p of list) {
            const periodData = { name: p.name, start: p.start, end: p.end };
            await setDoc(doc(db, "periods", p.id), periodData);
        }
    },

    // Alurações (30 Dias) - Persistência em Firestore
    getAlterations() {
        if (Object.keys(this.alterations).length > 0) return this.alterations;
        return JSON.parse(localStorage.getItem('escala_alterations_history') || '{}');
    },

    async saveAlteration(staffId, dateStr, weeks = 4) {
        const history = this.getAlterations();
        if (!history[staffId]) history[staffId] = [];

        // Calcula data de expiração (dateStr + semanas)
        const parts = dateStr.split('-').map(Number);
        const d = new Date(parts[0], parts[1] - 1, parts[2]);
        d.setDate(d.getDate() + (weeks * 7));

        // Formato YYYY-MM-DD sem shift de timezone
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const expiresStr = `${y}-${m}-${day}`;

        history[staffId].push({ date: dateStr, expires: expiresStr });
        this.alterations = history;

        await setDoc(doc(db, "settings", "alterations"), { history });
        localStorage.setItem('escala_alterations_history', JSON.stringify(history));
    },

    async saveAllAlterations(history) {
        this.alterations = history;
        await setDoc(doc(db, "settings", "alterations"), { history });
        localStorage.setItem('escala_alterations_history', JSON.stringify(history));
    },

    // Ranking Reset date (Persistência em Firestore)
    getRankingResetDate() {
        return this.rankingResetDate || localStorage.getItem('escala_ranking_reset_date') || EscalaConfig.SYSTEM_START_DATE;
    },

    async saveRankingResetDate(date) {
        this.rankingResetDate = date;
        await setDoc(doc(db, "settings", "ranking"), { resetDate: date });
        localStorage.setItem('escala_ranking_reset_date', date);
    }
};

// Export to window for global access (legacy compatibility)
window.EscalaStorage = EscalaStorage;

export { EscalaStorage };
