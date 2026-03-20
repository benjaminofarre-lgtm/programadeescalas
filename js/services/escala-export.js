/**
 * Escala Export Service
 * Formata a escala diária para clipboard. 
 */

const EscalaExport = {
    /**
     * Gera e copia a escala formatada do dia atual (se disponível). 
     */
    copyDailyScale(isoDate, schedule) {
        if (!schedule) return alert("Não há dados de escala para exportar deste dia.");

        const parts = isoDate.split('-');
        const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
        const days = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
        const dayOfWeek = days[dateObj.getDay()];
        const dateStr = `${String(dateObj.getDate()).padStart(2, '0')}/${String(dateObj.getMonth() + 1).padStart(2, '0')}/${String(dateObj.getFullYear()).slice(-2)}`;

        const teamName = schedule.team || "Nova Equipe";
        let text = `${dayOfWeek} ${dateStr}\n\n Equipe ${teamName} 🚩\n\nGv\n`;

        // GVs
        schedule.gvs.forEach((s, i) => {
            let cleanName = (s.name || '').replace(/✅ \[LIMPO\]|🚩 \[ALTERAÇÃO\]/g, '').trim();
            if (cleanName === '-- Vazio --') cleanName = '';

            // Se for freelancer, colocar asterisco e sufixo
            if (s.originalRole === 'FREELANCER' || (s.staffId && s.staffId.startsWith('freela_'))) {
                cleanName = `*${cleanName} Freela*`;
            }

            text += `${i + 1}. ${cleanName}\n`;
        });

        text += `\nGD\n`;

        // Guias
        schedule.guides.forEach((s, i) => {
            let cleanName = (s.name || '').replace(/✅ \[LIMPO\]|🚩 \[ALTERAÇÃO\]/g, '').trim();
            if (cleanName === '-- Vazio --') cleanName = '';

            // Se for freelancer, colocar asterisco e sufixo
            if (s.originalRole === 'FREELANCER' || (s.staffId && s.staffId.startsWith('freela_'))) {
                cleanName = `*${cleanName} Freela*`;
            }

            text += `${i + 1}. ${cleanName}\n`;
        });

        // Faltas (Automático)
        const teamFull = (window.staff || []).filter(s => s.team === teamName).sort((a, b) => a.name.localeCompare(b.name));
        const assignedIds = new Set([
            ...schedule.guides.map(s => s.staffId),
            ...schedule.gvs.map(s => s.staffId)
        ].filter(id => id));

        const missing = teamFull.filter(s => !assignedIds.has(s.id));

        if (missing.length > 0) {
            text += `\nFaltas\n\n`;
            missing.forEach(m => {
                text += `${m.name}\n`;
            });
        }

        navigator.clipboard.writeText(text).then(() => {
            alert("Escala copiada com sucesso!");
        }).catch(err => {
            console.error("Erro ao copiar:", err);
            window.prompt("Copie a escala:", text);
        });
    },

    /**
     * Exporta um conjunto de escalas e seus snapshots de justiça para um arquivo JSON baixável.
     */
    exportSchedulesBatch(startDate, endDate) {
        const schedules = window.schedules || {};
        const exportData = {
            exportDate: new Date().toISOString(),
            period: { start: startDate, end: endDate },
            data: {}
        };

        // Filtra as datas no período para ambas as equipes
        ['KIRRA', 'MUNDAKA'].forEach(team => {
            const teamSchedules = schedules[team] || {};
            Object.keys(teamSchedules)
                .filter(iso => iso >= startDate && iso <= endDate)
                .forEach(iso => {
                    exportData.data[`${team}_${iso}`] = teamSchedules[iso];
                });
        });

        if (Object.keys(exportData.data).length === 0) {
            return alert("Nenhuma escala encontrada neste período para exportar.");
        }

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `escala_lote_${startDate}_a_${endDate}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        alert(`Arquivo de lote gerado com ${Object.keys(exportData.data).length} escalas.`);
    },

};
