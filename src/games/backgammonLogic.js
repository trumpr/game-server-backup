const DEFAULT_LAYOUT = "WHITE,953.5,141.5,28.45029|WHITE,953.75,212.25,28.45029|WHITE,100.5,136.5,28.45029|WHITE,99.25,205.5,28.45029|WHITE,99.25,276.75,28.45029|WHITE,100.0,346.0,28.45029|WHITE,102.5,417.5,28.45029|WHITE,601.75,1207.25,28.45029|WHITE,601.75,907.0,28.45029|BROWN,953.0,1211.0,28.45029|BROWN,953.0,1147.75,28.45029|BROWN,378.5,133.0,28.45029|BROWN,377.5,196.0,28.45029|BROWN,377.75,257.5,28.45029|BROWN,601.5,133.0,28.45029|BROWN,601.5,195.25,28.45029|BROWN,602.0,260.5,28.45029|BROWN,603.25,326.25,28.45029|BROWN,604.5,390.5,28.45029|WHITE,602.25,1134.0,28.45029|WHITE,601.25,1058.75,28.45029|WHITE,600.5,983.0,28.45029|WHITE,379.5,1207.25,28.45029|WHITE,379.5,1133.75,28.45029|WHITE,379.25,1059.75,28.45029|BROWN,98.5,1213.5,28.45029|BROWN,100.0,1148.75,28.45029|BROWN,100.5,1083.25,28.45029|BROWN,98.75,1017.0,28.45029|BROWN,98.5,950.5,28.45029";

function parseLayout(layoutStr) {
    return layoutStr.split("|").map((p, index) => {
        const parts = p.split(",");
        return {
            id: `piece_${index}`,
            color: parts[0],
            x: parseFloat(parts[1]),
            y: parseFloat(parts[2]),
            size: parseFloat(parts[3])
        };
    });
}

function createBackgammonRoom() {
    return {
        pieces: parseLayout(DEFAULT_LAYOUT),
        dice: [0, 0],
        turn: "WHITE",
        players: []
    };
}

module.exports = {
    createBackgammonRoom,
    DEFAULT_LAYOUT
};
