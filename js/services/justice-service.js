/**
 * Justice Service
 * Lógica pura de cálculos de rotatividade e penalidades.
 */

const JusticeService = {
    /**
     * Calcula as estatísticas de rotatividade a partir de uma data de reset.
     */
    calculateJustice(teamName, startDate = null, endDate = '2099-01-01') {
        const stats = {};
        const staff = window.staff || [];
        const schedules = (window.schedules && window.schedules[teamName] ? window.schedules[teamName] : {}) || {};

        // Define data inicial de busca (global se não passar nada)
        // Define data inicial de busca (global se não passar nada)
        const dStart = startDate || (window.EscalaStorage ? window.EscalaStorage.getRankingResetDate() : localStorage.getItem('escala_ranking_reset_date')) || (window.SYSTEM_START_DATE || '2026-02-21');

        staff.filter(s => s.team === teamName && s.role === 'ROTATIVO').forEach(s => {
            stats[s.id] = { id: s.id, name: s.name, total: 0, guides: 0, ratio: 0, lastRole: null, shiftsSinceGuide: 999 };
        });

        const sortedDates = Object.keys(schedules)
            .filter(d => d >= dStart && d <= endDate)
            .sort();

        sortedDates.forEach(date => {
            const sch = schedules[date];
            if (sch.team !== teamName) return;

            sch.guides.forEach(slot => {
                if (slot.staffId && stats[slot.staffId]) {
                    stats[slot.staffId].guides++;
                    stats[slot.staffId].total++;
                    stats[slot.staffId].lastRole = 'guia';
                    stats[slot.staffId].shiftsSinceGuide = 0;
                }
            });
            sch.gvs.forEach(slot => {
                if (slot.staffId && stats[slot.staffId]) {
                    stats[slot.staffId].total++;
                    stats[slot.staffId].lastRole = 'gv';
                    stats[slot.staffId].shiftsSinceGuide++;
                }
            });
        });

        Object.keys(stats).forEach(id => {
            const s = stats[id];
            s.ratio = s.total === 0 ? 0 : (s.guides / s.total);
        });
        return stats;
    },

    /**
     * Calcula o "peso de azar" do funcionário com base nos 30 dias ANTERIORES ao início do novo ciclo gerado.
     * Retorna a proporção de GV tiradas (1 = 100% GVs).
     */
    calculateHistoricalWeight(teamName, refDateStartIso) {
        const weights = {};
        const staff = window.staff || [];
        const schedules = (window.schedules && window.schedules[teamName] ? window.schedules[teamName] : {}) || {};

        staff.filter(s => s.team === teamName && s.role === 'ROTATIVO').forEach(s => {
            weights[s.id] = { id: s.id, historicalWeight: 0, total: 0, gvs: 0 };
        });

        // Janela de 30 dias que antecedem a data inicial do período aberto
        const refDateObj = new Date(refDateStartIso.split('-').map(Number).join(','));
        const endDateObj = new Date(refDateObj);
        endDateObj.setDate(endDateObj.getDate() - 1);
        const startDateObj = new Date(refDateObj);
        startDateObj.setDate(startDateObj.getDate() - 30);

        const formatIso = (d) => {
            if (window.getBrasiliaISO) return window.getBrasiliaISO(d);
            const pad = n => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        };
        const startIso = formatIso(startDateObj);
        const endIso = formatIso(endDateObj);

        const sortedDates = Object.keys(schedules)
            .filter(d => d >= startIso && d <= endIso)
            .sort();

        sortedDates.forEach(date => {
            const sch = schedules[date];
            if (sch.team !== teamName) return;

            sch.guides.forEach(slot => {
                if (slot.staffId && weights[slot.staffId]) {
                    weights[slot.staffId].total++;
                }
            });
            sch.gvs.forEach(slot => {
                if (slot.staffId && weights[slot.staffId]) {
                    weights[slot.staffId].total++;
                    weights[slot.staffId].gvs++;
                }
            });
        });

        Object.keys(weights).forEach(id => {
            const w = weights[id];
            w.historicalWeight = w.total === 0 ? 0 : (w.gvs / w.total);
        });

        return weights;
    },

    getPenalizedStatus(staffId, forDateISO = null) {
        const history = (window.EscalaStorage ? window.EscalaStorage.getAlterations() : JSON.parse(localStorage.getItem('escala_alterations_history') || '{}'))[staffId] || [];

        // Se não passar data, usa HOJE (no formato YYYY-MM-DD local)
        let refDate = forDateISO;
        if (!refDate) {
            const now = new Date();
            refDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        }

        return history.some(item => {
            if (typeof item === 'object' && item.expires) {
                return refDate <= item.expires;
            }
            // Legado: 30 dias se for apenas uma string de data
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            return new Date(item) >= thirtyDaysAgo;
        }) ? 'penalized' : 'clean';
    }
};

window.JusticeService = JusticeService;
