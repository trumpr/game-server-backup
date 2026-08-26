function getCardValue(card) {
    const rank = card.slice(0, -1);
    if (rank === "A") return 11;
    if (["K", "Q", "J", "10"].includes(rank)) return 10;
    return Number(rank) || 0;
}

function calculateScore(hand) {
    if (!hand || hand.length === 0) return 0;
    if (hand.length === 3 && hand.every(c => c.startsWith("A"))) return 33;
    const suits = { "♣": 0, "♦": 0, "♥": 0, "♠": 0 };
    hand.forEach(c => { suits[c.slice(-1)] += getCardValue(c); });
    let max = Math.max(...Object.values(suits));
    const aces = hand.filter(c => c.startsWith("A")).length;
    if (aces === 2 && 22 > max) max = 22;
    const ranks = {};
    hand.forEach(c => { const r = c.slice(0, -1); ranks[r] = (ranks[r] || 0) + 1; });
    for (const r in ranks) {
        if (ranks[r] === 3) {
            let s = 0;
            if (r === "A") s = 33;
            else if (r === "6") s = 32.5;
            else if (r === "7") s = 21;
            else if (r === "8") s = 24;
            else if (r === "9") s = 27;
            else if (["10", "J", "Q", "K"].includes(r)) s = 30;
            if (s > max) max = s;
        }
    }
    return max;
}

function createDeck() {
    const suits = ["♣", "♦", "♥", "♠"], values = ["6", "7", "8", "9", "10", "J", "Q", "K", "A"];
    let deck = [];
    suits.forEach(s => values.forEach(v => deck.push(v + s)));
    return deck.sort(() => Math.random() - 0.5);
}

function createRoomObject(initialBet = 0.2, password = null) {
    return {
        players: Array(6).fill(null),
        hands: {},
        deck: createDeck(),
        pot: 0,
        dealer: 0,
        turn: 0,
        folded: {},
        initialBet,
        currentBet: initialBet,
        acUnlocked: false,
        gameInProgress: false,
        lastWinnerIdx: null,
        isSeka: false,
        sekaParticipants: [],
        sekaJoinedPlayers: [],
        password: password, // Şifrə əlavə olundu
        tyomnuActive: false,
        tyomnuPlayers: [],
        tyomnuChainInProgress: false,
        tyomnuChainIdx: 0,
        tyomnuChainAmount: 0
    };
}

module.exports = {
    calculateScore,
    createDeck,
    createRoomObject
};
