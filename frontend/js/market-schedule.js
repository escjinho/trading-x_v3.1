/**
 * MarketSchedule — 심볼별 마켓 운영시간 판단 모듈
 * Trading-X v3.1
 *
 * symbolInfoData (index.html)의 hours 데이터를 사용 (MT5 서버시간 UTC+2 기준)
 */

const MarketSchedule = (() => {

    function getMT5Offset() {
        const now = new Date();
        const year = now.getUTCFullYear();
        const mar31 = new Date(Date.UTC(year, 2, 31));
        const marchLastSun = 31 - mar31.getUTCDay();
        const dstStart = new Date(Date.UTC(year, 2, marchLastSun, 1, 0, 0));
        const oct31 = new Date(Date.UTC(year, 9, 31));
        const octLastSun = 31 - oct31.getUTCDay();
        const dstEnd = new Date(Date.UTC(year, 9, octLastSun, 1, 0, 0));
        return (now >= dstStart && now < dstEnd) ? 3 : 2;
    }

    function getServerTime() {
        const now = new Date();
        const offset = getMT5Offset();
        const serverMs = now.getTime() + (offset * 60 * 60 * 1000);
        const serverDate = new Date(serverMs);
        return {
            day: serverDate.getUTCDay(),
            hour: serverDate.getUTCHours(),
            minute: serverDate.getUTCMinutes(),
            offset: offset
        };
    }

    function getSchedule(symbol) {
        if (typeof symbolInfoData !== 'undefined' && symbolInfoData[symbol]) {
            return symbolInfoData[symbol].hours;
        }
        return null;
    }

    function isMarketOpen(symbol) {
        const hours = getSchedule(symbol);
        if (!hours) return _fallbackCheck(symbol);

        const server = getServerTime();
        const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
        const dayKey = dayNames[server.day];
        const dayHours = hours[dayKey];

        if (!dayHours || dayHours === '—' || dayHours === '-' || dayHours.trim() === '') {
            return false;
        }

        const currentMin = server.hour * 60 + server.minute;

        // 복수 세션 지원: "HH:MM - HH:MM, HH:MM - HH:MM, ..."
        const sessions = dayHours.split(',');
        for (const session of sessions) {
            const match = session.trim().match(/(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})/);
            if (match) {
                const openMin = parseInt(match[1]) * 60 + parseInt(match[2]);
                const closeMin = parseInt(match[3]) * 60 + parseInt(match[4]);
                if (currentMin >= openMin && currentMin <= closeMin) {
                    return true;
                }
            }
        }
        return false;
    }

    function _fallbackCheck(symbol) {
        const sym = (symbol || '').toUpperCase();
        if (/BTC|ETH|LTC|XRP|DOGE|SOL|ADA/.test(sym)) return true;
        const server = getServerTime();
        if (server.day === 0 || server.day === 6) return false;
        return true;
    }

    function getStatus(symbol) {
        const open = isMarketOpen(symbol);
        return { open: open, text: open ? '' : 'Market Closed' };
    }

    function debug(symbol) {
        const server = getServerTime();
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const status = getStatus(symbol || 'BTCUSD');
        console.log('[MarketSchedule] Server: ' + dayNames[server.day] + ' ' + server.hour + ':' + String(server.minute).padStart(2,'0') + ' (UTC+' + server.offset + ')');
        console.log('[MarketSchedule] ' + (symbol || 'BTCUSD') + ': ' + (status.open ? 'OPEN' : 'CLOSED'));
        return status;
    }

    return { isMarketOpen, getStatus, getServerTime, getMT5Offset, debug };
})();

window.MarketSchedule = MarketSchedule;
