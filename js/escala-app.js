/**
 * Escala Application Main
 * Orquestra a lógica de login, geração de escalas e utilitários.
 */

import { EscalaStorage } from "./services/escala-storage.js";

const EscalaApp = {
    async init() {
        // Inicialização básica de estado global
        window.currentDate = new Date();
        window.isSupervisor = false;

        document.getElementById('loadingOverlay').style.display = 'flex';
        try {
            const status = await EscalaStorage.init();

            if (!status || !status.success) {
                console.warn("Iniciando em modo Offline/Fallback:", status ? status.error : "Sem resposta de status");
                // Opcional: Avisar o usuário mas não bloquear a app
                const errorBanner = document.createElement('div');
                errorBanner.style = "background:#ffc107; color:black; padding:5px; text-align:center; font-size:12px; font-weight:bold;";
                errorBanner.innerText = "⚠ Modo Offline: Usando dados locais do navegador.";
                document.body.prepend(errorBanner);
            }

            const defaultEnd = new Date();
            defaultEnd.setMonth(defaultEnd.getMonth() + 2);
            defaultEnd.setDate(0);
            const endInput = document.getElementById('configEndDate');
            if (endInput) endInput.value = defaultEnd.toISOString().split('T')[0];

            const startInput = document.getElementById('configStartDate');
            if (startInput) startInput.value = new Date().toISOString().split('T')[0];

            window.renderPeriods();
            window.renderTeamList();
        } catch (error) {
            console.error("Erro Crítico na inicialização:", error);
            alert("Erro fatal ao iniciar aplicação.\n\nDetalhes: " + error.message);
        } finally {
            document.getElementById('loadingOverlay').style.display = 'none';
        }
    },

    // --- Autenticação ---
    toggleAuth() {
        if (window.isSupervisor) {
            window.isSupervisor = false;
            document.getElementById('appTitle').innerText = "GUARDA-VIDAS MONSTRAO DA SURFLAND";
            document.getElementById('authBtn').innerText = "🔒 Login Supervisor";
        } else {
            document.getElementById('loginModal').style.display = 'flex';
        }
        window.renderTeamList();
        window.renderCalendar();
    },

    attemptLogin() {
        const u = document.getElementById('loginUser').value;
        const p = document.getElementById('loginPass').value;
        if (u === EscalaConfig.AUTH_CREDENTIALS.user && p === EscalaConfig.AUTH_CREDENTIALS.pass) {
            window.isSupervisor = true;
            document.getElementById('loginModal').style.display = 'none';
            alert("Login realizado como Supervisor!");
            document.getElementById('appTitle').innerText = "SUPERVISOR";
            document.getElementById('authBtn').innerText = "🔓 Sair";
            window.renderPeriods();
            window.renderTeamList();
            window.renderCalendar();
        } else {
            alert("Senha incorreta.");
        }
    },

    // --- Utilitários de Data ---
    getBrasiliaISO(d) {
        // Garantimos que pegamos a data correta ignorando o fuso local do navegador
        // Usamos UTC para evitar que 00:00 se torne 21:00 do dia anterior
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    },
    getTodayISO() { return this.getBrasiliaISO(new Date()); },
    isPast(iso) { return iso < this.getTodayISO() || iso < EscalaConfig.SYSTEM_START_DATE; },
    getTeam(iso) {
        const parts = iso.split('-').map(Number);
        const refParts = EscalaConfig.SYSTEM_START_DATE.split('-').map(Number);
        const refDate = Date.UTC(refParts[0], refParts[1] - 1, refParts[2]);
        const targetDate = Date.UTC(parts[0], parts[1] - 1, parts[2]);
        const diffDays = Math.floor((targetDate - refDate) / (1000 * 60 * 60 * 24));
        return (Math.abs(diffDays) % 2 === 0) ? 'KIRRA' : 'MUNDAKA';
    },

    // --- Lógica de Geração ---
    computeScheduleForDate(isoDate, numGuias = 8, numGVs = 12) {
        const teamName = this.getTeam(isoDate);
        const teamMembers = (window.staff || []).filter(s => s.team === teamName);

        // Determina o intervalo do ranking: até UM DIA ANTES da data gerada para evitar 'olhar o futuro'
        const parts = isoDate.split('-').map(Number);
        const prevDateObj = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
        prevDateObj.setUTCDate(prevDateObj.getUTCDate() - 1);
        const prevIsoDate = this.getBrasiliaISO(prevDateObj);

        const activePeriod = (window.periods || []).find(p => p.id === window.activePeriodId);
        const startDate = activePeriod ? activePeriod.start : null;
        // IMPORTANTE: limitar até prevIsoDate em vez de activePeriod.end
        const endDate = activePeriod ? prevIsoDate : prevIsoDate;

        // Estatísticas restritas estritamente aos dias que JÁ PASSARAM do mês atual
        const justiceStats = JusticeService.calculateJustice(teamName, startDate, endDate);
        const historicalWeights = startDate ? JusticeService.calculateHistoricalWeight(teamName, startDate) : {};

        const rotativos = teamMembers.filter(s => s.role === 'ROTATIVO');

        rotativos.sort((a, b) => {
            const statA = justiceStats[a.id] || { total: 0, guides: 0, ratio: 0, lastRole: null, shiftsSinceGuide: 999 };
            const statB = justiceStats[b.id] || { total: 0, guides: 0, ratio: 0, lastRole: null, shiftsSinceGuide: 999 };

            const hwA = historicalWeights[a.id] || { total: 0, gvs: 0 };
            const hwB = historicalWeights[b.id] || { total: 0, gvs: 0 };

            // 1. Anti-Repetição (Prioridade Máxima): Se foi guia na última escala, vai para o fim da fila de guias.
            const aWasG = statA.lastRole === 'guia' ? 1 : 0;
            const bWasG = statB.lastRole === 'guia' ? 1 : 0;
            if (aWasG !== bWasG) return aWasG - bWasG;

            // 2. Proporção do Período Atual (Justiça Imediata)
            // Usamos Laplace Smoothing (v+1)/(n+2) para evitar divisões por zero e suavizar o início do mês
            const ratioCurrentA = (statA.guides + 1) / (statA.total + 2);
            const ratioCurrentB = (statB.guides + 1) / (statB.total + 2);

            if (Math.abs(ratioCurrentA - ratioCurrentB) > 0.01) {
                return ratioCurrentA - ratioCurrentB; // Menor ratio vem primeiro
            }

            // 3. Proporção Histórica (Tie-breaker 1)
            const ratioHistA = (hwA.total - hwA.gvs + 1) / (hwA.total + 2);
            const ratioHistB = (hwB.total - hwB.gvs + 1) / (hwB.total + 2);

            if (Math.abs(ratioHistA - ratioHistB) > 0.01) {
                return ratioHistA - ratioHistB;
            }

            // 4. Tempo de Espera (Tie-breaker 2)
            if (statA.shiftsSinceGuide !== statB.shiftsSinceGuide) {
                return statB.shiftsSinceGuide - statA.shiftsSinceGuide; // Quem espera há mais tempo vem primeiro
            }

            // 5. Aleatoriedade final
            return Math.random() - 0.5;
        });

        const finalGuides = teamMembers.filter(s => s.role === 'FIXO_GUIA').map(p => ({ staffId: p.id, name: p.name, originalRole: p.role, info: '' }));
        while (finalGuides.length < numGuias && rotativos.length > 0) {
            const p = rotativos.shift();

            // Mostrar no tooltip o ratio combinado que define a sua posição atual
            const stat = justiceStats[p.id] || { total: 0, guides: 0 };
            const hw = historicalWeights[p.id] || { total: 0, gvs: 0 };
            const combinedTotal = stat.total + hw.total;
            const combinedGuias = stat.guides + (hw.total - hw.gvs);
            const ratio = combinedTotal === 0 ? 0 : (combinedGuias / combinedTotal);

            finalGuides.push({ staffId: p.id, name: p.name, originalRole: p.role, info: `(${(ratio * 100).toFixed(0)}%)` });
        }
        const finalGVs = teamMembers.filter(s => s.role === 'FIXO_GV').map(p => ({ staffId: p.id, name: p.name, originalRole: p.role, info: '' }));
        while (finalGVs.length < numGVs && rotativos.length > 0) {
            const p = rotativos.shift();
            finalGVs.push({ staffId: p.id, name: p.name, originalRole: p.role, info: '' });
        }

        // Embaralha as alocações para rotacionar as posições/números (ex: evitar ser sempre GD1)
        const shuffle = (array) => {
            for (let i = array.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [array[i], array[j]] = [array[j], array[i]];
            }
        };
        shuffle(finalGuides);
        shuffle(finalGVs);

        while (finalGuides.length < numGuias) finalGuides.push({ staffId: null, name: '', originalRole: 'VAGO', info: 'Vazio' });
        while (finalGVs.length < numGVs) finalGVs.push({ staffId: null, name: '', originalRole: 'VAGO', info: 'Vazio' });
        return { team: teamName, guides: finalGuides, gvs: finalGVs, justiceSnapshot: justiceStats };
    },

    async saveDay() {
        if (!window.isSupervisor) return alert("🔒 Login necessário.");
        document.getElementById('loadingOverlay').style.display = 'flex';
        try {
            const getSlots = (type) => [...document.querySelectorAll(`.slot-row.role-${type} .slot-select`)].map(select => {
                const opt = select.options[select.selectedIndex];
                const cleanName = opt.text.split(' (')[0].replace(/✅ \[LIMPO\]|🚩 \[ALTERAÇÃO\]/g, '').trim();
                return { staffId: opt.value || null, name: cleanName, originalRole: opt.getAttribute('data-role') || 'VAGO', info: '' };
            });
            const oldData = EscalaStorage.schedules[window.activeTeam][window.selectedDateISO];
            UndoService.push('schedule', window.selectedDateISO, oldData || null);

            // Calcula estatísticas atuais para o snapshot
            const currentStats = JusticeService.calculateJustice(this.getTeam(window.selectedDateISO), window.selectedDateISO);

            const data = {
                team: this.getTeam(window.selectedDateISO),
                guides: getSlots('guia'),
                gvs: getSlots('gv'),
                justiceSnapshot: currentStats
            };
            await EscalaStorage.saveSchedule(window.selectedDateISO, data);
            alert("Salvo!");
            window.renderCalendar();
            window.closeDayEditor();
        } catch (e) { alert("Erro: " + e.message); }
        finally { document.getElementById('loadingOverlay').style.display = 'none'; }
    },

    async generateFromMother() {
        if (!window.isSupervisor) return alert("🔒 Login necessário.");
        CalendarRenderer.showMotherScaleModal();
    },

    async confirmGenerateMother() {
        const name = document.getElementById('motherScaleName').value;
        const start = document.getElementById('motherStartDate').value;
        const end = document.getElementById('motherEndDate').value;

        if (!name || !start || !end) return alert("Preencha todos os campos.");
        if (start > end) return alert("Data início não pode ser maior que fim.");

        document.getElementById('loadingOverlay').style.display = 'flex';
        try {
            // 1. Cria o Novo Período (Lote)
            const periodId = await EscalaStorage.savePeriod({ name, start, end });

            // 2. Salva a "Escala Mãe" no dia atual para este novo lote (se necessário)
            // Na verdade, a escala já está nos inputs do editor.
            const getSlots = (type) => [...document.querySelectorAll(`.slot-row.role-${type} .slot-select`)].map(select => {
                const opt = select.options[select.selectedIndex];
                const cleanName = opt.text.split(' (')[0].replace(/✅ \[LIMPO\]|🚩 \[ALTERAÇÃO\]/g, '').trim();
                return { staffId: opt.value || null, name: cleanName, originalRole: opt.getAttribute('data-role') || 'VAGO', info: '' };
            });

            const motherData = {
                team: window.activeTeam,
                guides: getSlots('guia'),
                gvs: getSlots('gv'),
                justiceSnapshot: JusticeService.calculateJustice(window.activeTeam, window.selectedDateISO)
            };

            // Salva a escala do dia selecionado
            await EscalaStorage.saveSchedule(window.selectedDateISO, motherData);

            // 3. Gera as próximas escalas como se fosse um lote normal
            const startParts = start.split('-').map(Number);
            let pointer = new Date(Date.UTC(startParts[0], startParts[1] - 1, startParts[2], 12, 0, 0));
            const stopParts = end.split('-').map(Number);
            const stopDate = new Date(Date.UTC(stopParts[0], stopParts[1] - 1, stopParts[2], 12, 0, 0));

            const numG = parseInt(document.getElementById('motherNumGDs').value) || 8;
            const numV = parseInt(document.getElementById('motherNumGVs').value) || 12;

            while (pointer <= stopDate) {
                const iso = this.getBrasiliaISO(pointer);
                const team = this.getTeam(iso);

                // Só gera se:
                // 1. Data pertence à equipe ativa
                // 2. Não é o dia da "Mãe" (já salvamos acima)
                if (team === window.activeTeam && iso !== window.selectedDateISO) {
                    const sch = this.computeScheduleForDate(iso, numG, numV);
                    await EscalaStorage.saveSchedule(iso, sch);
                }
                pointer.setUTCDate(pointer.getUTCDate() + 1);
            }

            alert(`Lote "${name}" gerado com sucesso a partir da escala mãe!`);
            CalendarRenderer.hideMotherScaleModal();
            window.closeDayEditor();
            window.renderPeriods();
            CalendarRenderer.openPeriod(periodId);
        } catch (e) {
            alert("Erro ao gerar lote: " + e.message);
        } finally {
            document.getElementById('loadingOverlay').style.display = 'none';
        }
    },


    // --- Gestão de Períodos ---
    showNewPeriodForm() {
        if (!window.isSupervisor) return alert("🔒 Login necessário.");
        document.getElementById('newPeriodForm').style.display = 'block';
        window.scrollTo(0, 0);
    },

    async createPeriod() {
        const name = document.getElementById('newPeriodName').value;
        const start = document.getElementById('configStartDate').value;
        const end = document.getElementById('configEndDate').value;

        if (!name || !start || !end) return alert("Preencha o Nome, Início e Fim do Período.");
        if (start > end) return alert("Data início não pode ser maior que fim.");

        document.getElementById('loadingOverlay').style.display = 'flex';
        try {
            // Salva o Período
            const periodId = await EscalaStorage.savePeriod({ name, start, end });

            // Gera as Escalas (Lote)
            const numG = parseInt(document.getElementById('configGuias').value) || 8;
            const numV = parseInt(document.getElementById('configGVs').value) || 12;

            const startParts = start.split('-').map(Number);
            let pointer = new Date(Date.UTC(startParts[0], startParts[1] - 1, startParts[2], 12, 0, 0));
            const stopParts = end.split('-').map(Number);
            const stopDate = new Date(Date.UTC(stopParts[0], stopParts[1] - 1, stopParts[2], 12, 0, 0));

            let countNew = 0;
            let countExisting = 0;

            while (pointer <= stopDate) {
                const iso = this.getBrasiliaISO(pointer);
                const team = this.getTeam(iso);

                // SÓ GERA SE: 
                // 1. Data pertence à equipe que está carregando o lote (window.activeTeam)
                // 2. Não existe nada salvo (ou se quiser resetar)
                if (team === window.activeTeam && !EscalaStorage.schedules[team][iso]) {
                    const sch = this.computeScheduleForDate(iso, numG, numV);
                    await EscalaStorage.saveSchedule(iso, sch);
                    countNew++;
                } else if (team === window.activeTeam) {
                    countExisting++;
                }
                pointer.setUTCDate(pointer.getUTCDate() + 1);
            }

            alert(`Escala de "${name}" criada com sucesso!\n\n✅ ${countExisting} dias já existentes foram recuperados.\n✨ ${countNew} novos dias foram gerados.`);
            document.getElementById('newPeriodForm').style.display = 'none';
            document.getElementById('newPeriodName').value = '';

            window.renderPeriods();
            CalendarRenderer.openPeriod(periodId);
        } catch (e) {
            alert("Erro ao criar: " + e.message);
        } finally {
            document.getElementById('loadingOverlay').style.display = 'none';
        }
    },

    async regenerateActivePeriod() {
        if (!window.activePeriodId) return;
        const p = EscalaStorage.periods.find(item => item.id === window.activePeriodId);
        if (!p) return;

        if (!confirm(`🚀 Deseja (re)gerar todas as escalas para o período "${p.name}"?\nIsso substituirá as escalas diárias existentes neste intervalo.`)) return;

        document.getElementById('loadingOverlay').style.display = 'flex';
        try {
            const numG = parseInt(document.getElementById('regenConfigGuias').value) || parseInt(document.getElementById('configGuias').value) || 8;
            const numV = parseInt(document.getElementById('regenConfigGVs').value) || parseInt(document.getElementById('configGVs').value) || 12;

            const startParts = p.start.split('-').map(Number);
            let pointer = new Date(Date.UTC(startParts[0], startParts[1] - 1, startParts[2], 12, 0, 0));
            const stopParts = p.end.split('-').map(Number);
            const stopDate = new Date(Date.UTC(stopParts[0], stopParts[1] - 1, stopParts[2], 12, 0, 0));

            while (pointer <= stopDate) {
                const iso = this.getBrasiliaISO(pointer);
                if (this.getTeam(iso) === window.activeTeam) {
                    await EscalaStorage.saveSchedule(iso, this.computeScheduleForDate(iso, numG, numV));
                }
                pointer.setUTCDate(pointer.getUTCDate() + 1);
            }
            alert("Escalas do período geradas com sucesso!");
            CalendarRenderer.openPeriod(p.id);
        } catch (e) {
            alert("Erro ao gerar: " + e.message);
        } finally {
            document.getElementById('loadingOverlay').style.display = 'none';
        }
    },

    async deletePeriod(id) {
        if (!confirm("Tem certeza que deseja excluir esta escala salva do programa?")) return;

        const oldPeriods = JSON.parse(JSON.stringify(EscalaStorage.periods));
        UndoService.push('periods', null, oldPeriods);

        document.getElementById('loadingOverlay').style.display = 'flex';
        try {
            await EscalaStorage.deletePeriod(id);
            alert("Escala excluída com sucesso.");
            window.renderPeriods();
        } catch (e) {
            alert("Erro ao excluir: " + e.message);
        } finally {
            document.getElementById('loadingOverlay').style.display = 'none';
        }
    },

    async cancelAlteration(staffId) {
        if (!confirm("Deseja cancelar a última alteração registrada para este funcionário?")) return;

        const history = EscalaStorage.getAlterations();
        if (!history[staffId] || history[staffId].length === 0) return;

        UndoService.push('alteration', null, JSON.parse(JSON.stringify(history)));

        // Remove a última entrada do histórico
        history[staffId].pop();
        if (history[staffId].length === 0) delete history[staffId];

        document.getElementById('loadingOverlay').style.display = 'flex';
        try {
            await EscalaStorage.saveAllAlterations(history);
            window.renderTeamList();
            const staff = (EscalaStorage.staff || []).find(s => s.id === staffId);
            if (staff) window.renderStats(staff.team);
            alert("Alteração cancelada!");
        } catch (e) {
            alert("Erro ao cancelar alteração: " + e.message);
        } finally {
            document.getElementById('loadingOverlay').style.display = 'none';
        }
    },

    async addStaff() {
        if (!window.isSupervisor) return alert("Login necessário.");
        const name = document.getElementById('addName').value;
        const team = document.getElementById('addTeam').value;
        const role = document.getElementById('addRole').value;
        if (!name) return alert("Digite o nome.");
        document.getElementById('loadingOverlay').style.display = 'flex';
        try {
            UndoService.push('staff', null, EscalaStorage.staff);
            EscalaStorage.staff.push({ id: Date.now().toString(), name, team, role });
            await EscalaStorage.saveStaff();
            window.renderTeamList();
            document.getElementById('addName').value = '';
        } catch (e) { alert("Erro: " + e.message); }
        finally { document.getElementById('loadingOverlay').style.display = 'none'; }
    },
    async removeStaff(idx) {
        if (!window.isSupervisor) return alert("Login necessário.");
        if (!confirm('Tem certeza?')) return;
        document.getElementById('loadingOverlay').style.display = 'flex';
        try {
            UndoService.push('staff', null, EscalaStorage.staff);
            EscalaStorage.staff.splice(idx, 1);
            await EscalaStorage.saveStaff();
            window.renderTeamList();
        } catch (e) { alert("Erro: " + e.message); }
        finally { document.getElementById('loadingOverlay').style.display = 'none'; }
    },

    async addFreelancer() {
        if (!window.isSupervisor) return alert("Login necessário.");
        const name = document.getElementById('addFreelaName').value;
        if (!name) return alert("Digite o nome do freelancer.");
        document.getElementById('loadingOverlay').style.display = 'flex';
        try {
            UndoService.push('freelancers', null, EscalaStorage.freelancers);
            EscalaStorage.freelancers.push({ id: 'freela_' + Date.now(), name, role: 'FREELANCER' });
            await EscalaStorage.saveFreelancers();
            window.renderTeamList();
            document.getElementById('addFreelaName').value = '';
        } catch (e) { alert("Erro: " + e.message); }
        finally { document.getElementById('loadingOverlay').style.display = 'none'; }
    },

    async removeFreelancer(idx) {
        if (!window.isSupervisor) return alert("Login necessário.");
        if (!confirm('Tem certeza?')) return;
        document.getElementById('loadingOverlay').style.display = 'flex';
        try {
            UndoService.push('freelancers', null, EscalaStorage.freelancers);
            EscalaStorage.freelancers.splice(idx, 1);
            await EscalaStorage.saveFreelancers();
            window.renderTeamList();
        } catch (e) { alert("Erro: " + e.message); }
        finally { document.getElementById('loadingOverlay').style.display = 'none'; }
    }
};

// --- Exposições Globais ---
window.toggleAuth = () => EscalaApp.toggleAuth();
window.attemptLogin = () => EscalaApp.attemptLogin();
window.copyToClipboard = () => {
    const iso = window.selectedDateISO;
    const team = window.activeTeam;
    if (!team) return alert("Selecione uma equipe primeiro.");
    EscalaExport.copyDailyScale(iso, EscalaStorage.schedules[team][iso]);
};
window.downloadBatch = () => {
    const start = document.getElementById('configStartDate').value;
    const end = document.getElementById('configEndDate').value;
    if (!start || !end) return alert("Selecione o período.");
    EscalaExport.exportSchedulesBatch(start, end);
};
window.saveDay = () => EscalaApp.saveDay();
window.generateBatch = () => EscalaApp.generateBatch();
window.generateFromMother = () => EscalaApp.generateFromMother();
window.confirmGenerateMother = () => EscalaApp.confirmGenerateMother();
window.hideMotherScaleModal = () => CalendarRenderer.hideMotherScaleModal();
window.addStaff = () => EscalaApp.addStaff();
window.removeStaff = (idx) => EscalaApp.removeStaff(idx);
window.addFreelancer = () => EscalaApp.addFreelancer();
window.removeFreelancer = (idx) => EscalaApp.removeFreelancer(idx);

// Period UI
window.showNewPeriodForm = () => EscalaApp.showNewPeriodForm();
window.createPeriod = () => EscalaApp.createPeriod();
window.deletePeriod = (id) => EscalaApp.deletePeriod(id);
window.renderPeriods = () => CalendarRenderer.renderPeriods();
window.backToDashboard = () => CalendarRenderer.backToDashboard();
window.regenerateActivePeriod = () => EscalaApp.regenerateActivePeriod();
window.selectTeam = (team) => CalendarRenderer.selectTeam(team);
window.cancelAlteration = (id) => EscalaApp.cancelAlteration(id);
window.renderFreelancerTab = () => CalendarRenderer.renderFreelancerTab();


window.generateSingleDayUI = () => {
    const numG = parseInt(document.getElementById('configGuias').value) || 8;
    const numV = parseInt(document.getElementById('configGVs').value) || 12;
    const sch = EscalaApp.computeScheduleForDate(window.selectedDateISO, numG, numV);
    window.renderEditorSlots(sch.guides, sch.gvs);
};
window.resetRankingDate = async () => {
    if (confirm("Zerar ranking?")) {
        document.getElementById('loadingOverlay').style.display = 'flex';
        try {
            await EscalaStorage.saveRankingResetDate(EscalaApp.getTodayISO());
            window.renderStats('KIRRA');
            alert("Ranking zerado com sucesso!");
        } catch (e) {
            alert("Erro ao zerar ranking: " + e.message);
        } finally {
            document.getElementById('loadingOverlay').style.display = 'none';
        }
    }
};
window.reportAlteration = async (id, name) => {
    const today = EscalaApp.getTodayISO();
    const weeks = prompt(`Marcar alteração para ${name}?\n\nDigite a duração:\n1 - Uma semana\n2 - Duas semanas\n3 - Três semanas\n4 - Um mês (Padrão)`, "4");

    if (weeks === null) return;
    const numWeeks = parseInt(weeks);
    if (isNaN(numWeeks) || numWeeks < 1 || numWeeks > 52) {
        return alert("Duração inválida. Use um número de 1 a 4.");
    }

    document.getElementById('loadingOverlay').style.display = 'flex';
    try {
        UndoService.push('alteration', null, JSON.parse(JSON.stringify(EscalaStorage.getAlterations())));
        await EscalaStorage.saveAlteration(id, today, numWeeks);

        window.renderTeamList();
        const staff = (EscalaStorage.staff || []).find(s => s.id === id);
        if (staff) window.renderStats(staff.team);

        if (document.getElementById('dayEditor').style.display !== 'none') {
            window.openDayEditor(window.selectedDateISO);
        }
        window.renderCalendar();
        alert(`Alteração registrada para ${name} por ${numWeeks} semana(s).`);
    } catch (e) {
        alert("Erro ao registrar alteração: " + e.message);
    } finally {
        document.getElementById('loadingOverlay').style.display = 'none';
    }
};

window.switchTab = (id, event) => {
    document.querySelectorAll('.tab-content, .nav-item').forEach(el => el.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    if (event && event.currentTarget) {
        event.currentTarget.classList.add('active');
    }
    const label = document.getElementById('rankingStartDateLabel');
    if (label) label.innerText = EscalaStorage.getRankingResetDate().split('-').reverse().join('/');
    if (id === 'tabStats') window.renderStats('KIRRA');
    if (id === 'tabFreelancers') window.renderFreelancerTab();
};
window.changeMonth = (n) => { window.currentDate.setMonth(window.currentDate.getMonth() + n); window.renderCalendar(); };
window.closeDayEditor = () => document.getElementById('dayEditor').style.display = 'none';
window.getBrasiliaISO = (d) => EscalaApp.getBrasiliaISO(d);
window.getTodayISO = () => EscalaApp.getTodayISO();
window.isPast = (iso) => EscalaApp.isPast(iso);
window.getTeam = (iso) => EscalaApp.getTeam(iso);

EscalaApp.init();
