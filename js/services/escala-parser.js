/**
 * Escala Parser Service
 * Interpreta texto de escala colado pelo usuário e retorna estrutura de dados.
 */

const EscalaParser = {
    /**
     * Normaliza uma string: remove acentos, asteriscos e espaços extras;
     * converte para minúsculas para comparação.
     */
    _normalize(str) {
        return (str || '')
            .toLowerCase()
            .replace(/\*/g, '')            // remove asteriscos de formatação
            .replace(/[áàâãä]/g, 'a')
            .replace(/[éèêë]/g, 'e')
            .replace(/[íìîï]/g, 'i')
            .replace(/[óòôõö]/g, 'o')
            .replace(/[úùûü]/g, 'u')
            .replace(/[ç]/g, 'c')
            .replace(/\s+/g, ' ')
            .trim();
    },

    /**
     * Tenta encontrar o melhor match de nome entre a lista de staff/freelancers.
     * Usa correspondência parcial: verifica se alguma palavra do nome digitado 
     * está contida no nome do staff cadastrado (ou vice-versa).
     */
    _findBestMatch(rawName, allPeople) {
        const normalized = this._normalize(rawName);

        // 1. Correspondência exata
        const exact = allPeople.find(p => this._normalize(p.name) === normalized);
        if (exact) return exact;

        // 2. Correspondência parcial: o nome digitado está contido no nome cadastrado
        const contains = allPeople.find(p => this._normalize(p.name).includes(normalized) || normalized.includes(this._normalize(p.name)));
        if (contains) return contains;

        // 3. Correspondência por palavras (pelo menos 2 palavras em comum)
        const normalizedWords = normalized.split(' ').filter(w => w.length > 2);
        let bestMatch = null;
        let bestScore = 0;

        allPeople.forEach(p => {
            const pWords = this._normalize(p.name).split(' ');
            const commonWords = normalizedWords.filter(w => pWords.includes(w));
            if (commonWords.length > bestScore) {
                bestScore = commonWords.length;
                bestMatch = p;
            }
        });

        if (bestScore >= 1) return bestMatch;
        return null;
    },

    /**
     * Analisa se um nome está marcado com asteriscos (indicando freelancer no texto).
     */
    _isFreelancerInText(rawName) {
        return rawName.trim().startsWith('*') || rawName.trim().endsWith('*');
    },

    /**
     * Converte uma linha de escala (ex: "1. *Nome Freela*") para o nome limpo.
     */
    _cleanLineName(line) {
        // Remove o número e ponto do início (ex: "1. ", "12. ")
        return line.replace(/^\d+\.\s*/, '').replace(/\s+Freela\s*/i, '').trim();
    },

    /**
     * Parseia o texto e retorna { team, guides: [], gvs: [], warnings: [] }
     */
    parseText(text) {
        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const allStaff = window.staff || [];
        const allFreelancers = window.freelancers || [];
        const allPeople = [...allStaff, ...allFreelancers];

        const result = {
            team: null,
            guides: [],
            gvs: [],
            warnings: []
        };

        let section = null; // 'gv', 'gd', 'faltas'

        for (const line of lines) {
            const lower = line.toLowerCase();

            // Detectar equipe
            if (lower.includes('kirra')) {
                result.team = 'KIRRA';
                continue;
            }
            if (lower.includes('mundaka')) {
                result.team = 'MUNDAKA';
                continue;
            }

            // Mudar seção
            if (/^gv$/i.test(line)) { section = 'gv'; continue; }
            if (/^gd$/i.test(line)) { section = 'gd'; continue; }
            if (/^faltas/i.test(line)) { section = 'faltas'; continue; }

            // Processar linha numerada (ex: "1. Nome")
            if (/^\d+\./.test(line) && (section === 'gv' || section === 'gd')) {
                const rawName = this._cleanLineName(line);
                if (!rawName) {
                    const slot = { staffId: null, name: '', originalRole: 'VAGO', info: '' };
                    section === 'gv' ? result.gvs.push(slot) : result.guides.push(slot);
                    continue;
                }

                const isFreela = this._isFreelancerInText(line);
                const cleanRaw = rawName.replace(/\*/g, '').trim();

                // Buscar primeiro em freelancers se marcado como freela
                let matched = null;
                if (isFreela) {
                    matched = this._findBestMatch(cleanRaw, allFreelancers);
                }
                // Se não achou ou não está marcado como freela, busca entre todos
                if (!matched) {
                    matched = this._findBestMatch(cleanRaw, allPeople);
                }

                if (matched) {
                    const slot = {
                        staffId: matched.id,
                        name: matched.name,
                        originalRole: matched.role,
                        info: ''
                    };
                    section === 'gv' ? result.gvs.push(slot) : result.guides.push(slot);
                } else {
                    result.warnings.push(`Não encontrado: "${cleanRaw}"`);
                    const slot = { staffId: null, name: cleanRaw, originalRole: 'VAGO', info: '⚠ Não encontrado' };
                    section === 'gv' ? result.gvs.push(slot) : result.guides.push(slot);
                }
            }
        }

        return result;
    }
};

window.EscalaParser = EscalaParser;
