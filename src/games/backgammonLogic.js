const DEFAULT_LAYOUT = [
    // WHITE (Moves 23 -> 0)
    { id: "w1", color: "WHITE", point: 23 }, { id: "w2", color: "WHITE", point: 23 },
    { id: "w3", color: "WHITE", point: 12 }, { id: "w4", color: "WHITE", point: 12 }, { id: "w5", color: "WHITE", point: 12 }, { id: "w6", color: "WHITE", point: 12 }, { id: "w7", color: "WHITE", point: 12 },
    { id: "w8", color: "WHITE", point: 7 }, { id: "w9", color: "WHITE", point: 7 }, { id: "w10", color: "WHITE", point: 7 },
    { id: "w11", color: "WHITE", point: 5 }, { id: "w12", color: "WHITE", point: 5 }, { id: "w13", color: "WHITE", point: 5 }, { id: "w14", color: "WHITE", point: 5 }, { id: "w15", color: "WHITE", point: 5 },

    // BROWN (Moves 0 -> 23)
    { id: "b1", color: "BROWN", point: 0 }, { id: "b2", color: "BROWN", point: 0 },
    { id: "b3", color: "BROWN", point: 11 }, { id: "b4", color: "BROWN", point: 11 }, { id: "b5", color: "BROWN", point: 11 }, { id: "b6", color: "BROWN", point: 11 }, { id: "b7", color: "BROWN", point: 11 },
    { id: "b8", color: "BROWN", point: 16 }, { id: "b9", color: "BROWN", point: 16 }, { id: "b10", color: "BROWN", point: 16 },
    { id: "b11", color: "BROWN", point: 18 }, { id: "b12", color: "BROWN", point: 18 }, { id: "b13", color: "BROWN", point: 18 }, { id: "b14", color: "BROWN", point: 18 }, { id: "b15", color: "BROWN", point: 18 }
];

function createBackgammonRoom(bet = 1.0, password = null) {
    return {
        pieces: JSON.parse(JSON.stringify(DEFAULT_LAYOUT)),
        bar: { WHITE: 0, BROWN: 0 },
        off: { WHITE: 0, BROWN: 0 },
        dice: [0, 0],
        movesLeft: [],
        turn: "WHITE",
        players: [],
        playerColors: {},
        bet: bet,
        password: password,
        gameStarted: false,
        winner: null
    };
}

function getPossibleMoves(room, pieceId) {
    const piece = room.pieces.find(p => p.id === pieceId);
    if (!piece || piece.color !== room.turn || room.movesLeft.length === 0) return [];

    // Əgər Bar-da daş varsa, başqa daş tərpənə bilməz
    if (room.bar[piece.color] > 0 && piece.point !== -1) return [];

    const moves = [];
    const direction = piece.color === "WHITE" ? -1 : 1;
    const currentPoint = piece.point;

    room.movesLeft.forEach(step => {
        let target;
        if (piece.point === -1) { // Bar-dan qayıtma
            target = piece.color === "WHITE" ? (24 - step) : (step - 1);
        } else {
            target = currentPoint + (step * direction);
        }

        if (target >= 0 && target <= 23) {
            const opponentColor = piece.color === "WHITE" ? "BROWN" : "WHITE";
            const piecesOnTarget = room.pieces.filter(p => p.point === target);
            const isBlocked = piecesOnTarget.length >= 2 && piecesOnTarget[0].color === opponentColor;

            if (!isBlocked) moves.push({ target, step });
        }
    });

    return moves;
}

module.exports = {
    createBackgammonRoom,
    getPossibleMoves,
    rollDice: () => {
        const d1 = Math.floor(Math.random() * 6) + 1;
        const d2 = Math.floor(Math.random() * 6) + 1;
        return d1 === d2 ? [d1, d1, d1, d1] : [d1, d2];
    }
};
