const game = new Chess();
const boardElement = document.getElementById('board');
const statusElement = document.getElementById('status');
const moveListElement = document.getElementById('move-list');
const resetBtn = document.getElementById('reset-btn');
const difficultySelect = document.getElementById('difficulty-select');

// Auth elements
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const gameWrapper = document.getElementById('game-wrapper');
const authContainer = document.getElementById('auth-container');
const userInfo = document.getElementById('user-info');
const userEmailSpan = document.getElementById('user-email');

// --- Configuration ---
let COGNITO_DOMAIN;
let CLIENT_ID;
const REDIRECT_URI = window.location.href.split('?')[0].split('#')[0]; // Current page

// --- Auth Logic ---

function parseJwt(token) {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(jsonPayload);
    } catch (e) {
        return null;
    }
}

async function init() {
    try {
        const response = await fetch('config.json');
        const config = await response.json();
        COGNITO_DOMAIN = config.cognitoDomain; // Remove trailing slash if present? .baseUrl() does not have trailing slash usually.
        CLIENT_ID = config.clientId;
        
        checkAuth();
    } catch (e) {
        console.error("Failed to load config", e);
        alert("Failed to load application configuration.");
    }
}

function checkAuth() {
    // 1. Check for tokens in URL hash (Implicit Grant)
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    
    // Prefer ID token for user details
    if (params.has('id_token')) {
        const token = params.get('id_token');
        localStorage.setItem('chess_auth_token', token);
        history.replaceState(null, null, ' ');
    } else if (params.has('access_token')) {
        // Fallback if no ID token
        const token = params.get('access_token');
        localStorage.setItem('chess_auth_token', token);
        history.replaceState(null, null, ' ');
    }

    // 2. Check storage
    const token = localStorage.getItem('chess_auth_token');
    
    if (token) {
        // Simple check: token exists. In production, verify signature and expiry.
        showGame(token);
    } else {
        showLogin();
    }
}

function showGame(token) {
    authContainer.style.display = 'none';
    loginBtn.style.display = 'none'; // Ensure login button is hidden

    userInfo.style.display = 'flex';
    if (token) {
        const payload = parseJwt(token);
        if (payload && (payload.email || payload['cognito:username'])) {
            userEmailSpan.textContent = payload.email || payload['cognito:username'];
        } else {
            userEmailSpan.textContent = 'Player';
        }
    }

    gameWrapper.style.display = 'block';
    
    // Trigger a resize or render to ensure board is drawn correctly
    // Wait for Chess instance and board to be ready
    if(window.game && window.boardElement) {
       renderBoard();
    }
}


function showLogin() {
    authContainer.style.display = 'block';
    loginBtn.style.display = 'inline-block';
    userInfo.style.display = 'none';
    gameWrapper.style.display = 'none';
}

function login() {
    if (!COGNITO_DOMAIN || !CLIENT_ID) {
        alert("Configuration not loaded yet.");
        return;
    }
    // Build Cognito Hosted UI URL
    // Use 'token' for Implicit Grant
    const url = `${COGNITO_DOMAIN}/login?client_id=${CLIENT_ID}&response_type=token&scope=email+openid+profile&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
    window.location.href = url;
}

function logout() {
    localStorage.removeItem('chess_auth_token');
    // Optional: Logout from Cognito
    if (COGNITO_DOMAIN && CLIENT_ID) {
        const url = `${COGNITO_DOMAIN}/logout?client_id=${CLIENT_ID}&logout_uri=${encodeURIComponent(REDIRECT_URI)}`;
        window.location.href = url;
    } else {
         window.location.reload();
    }
}

loginBtn.addEventListener('click', login);
logoutBtn.addEventListener('click', logout);

// Initialize Auth
init();

let selectedSquare = null;
let moveHistory = [];

const PIECES = {
    'p': '♟', 'r': '♜', 'n': '♞', 'b': '♝', 'q': '♛', 'k': '♚',
    'P': '♙', 'R': '♖', 'N': '♘', 'B': '♗', 'Q': '♕', 'K': '♔'
};

// Evaluation Tables (simplified)
const weights = { p: 10, n: 30, b: 30, r: 50, q: 90, k: 900 };

const pst_white = {
    p: [
        [0,  0,  0,  0,  0,  0,  0,  0],
        [50, 50, 50, 50, 50, 50, 50, 50],
        [10, 10, 20, 30, 30, 20, 10, 10],
        [5,  5, 10, 25, 25, 10,  5,  5],
        [0,  0,  0, 20, 20,  0,  0,  0],
        [5, -5,-10,  0,  0,-10, -5,  5],
        [5, 10, 10,-20,-20, 10, 10,  5],
        [0,  0,  0,  0,  0,  0,  0,  0]
    ],
    n: [
        [-50,-40,-30,-30,-30,-30,-40,-50],
        [-40,-20,  0,  0,  0,  0,-20,-40],
        [-30,  0, 10, 15, 15, 10,  0,-30],
        [-30,  5, 15, 20, 20, 15,  5,-30],
        [-30,  0, 15, 20, 20, 15,  0,-30],
        [-30,  5, 10, 15, 15, 10,  5,-30],
        [-40,-20,  0,  5,  5,  0,-20,-40],
        [-50,-40,-30,-30,-30,-30,-40,-50]
    ]
};

function renderBoard() {
    boardElement.innerHTML = '';
    const board = game.board();
    const validMoves = selectedSquare ? game.moves({ square: selectedSquare, verbose: true }) : [];

    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const square = board[r][c];
            const squareDiv = document.createElement('div');
            const pos = String.fromCharCode(97 + c) + (8 - r);
            
            squareDiv.className = `square ${(r + c) % 2 === 0 ? 'light' : 'dark'}`;
            squareDiv.dataset.pos = pos;

            if (square) {
                const pieceSpan = document.createElement('span');
                pieceSpan.className = 'piece';
                pieceSpan.innerText = PIECES[square.color === 'w' ? square.type.toUpperCase() : square.type];
                squareDiv.appendChild(pieceSpan);
            }

            if (selectedSquare === pos) {
                squareDiv.classList.add('selected');
            }

            // Highlight valid moves
            if (validMoves.some(m => m.to === pos)) {
                squareDiv.classList.add('highlight');
            }

            squareDiv.addEventListener('click', () => onSquareClick(pos));
            boardElement.appendChild(squareDiv);
        }
    }
    updateStatus();
}

function onSquareClick(pos) {
    if (game.game_over()) return;

    if (selectedSquare === pos) {
        selectedSquare = null;
        renderBoard();
        return;
    }

    if (selectedSquare) {
        const move = game.move({
            from: selectedSquare,
            to: pos,
            promotion: 'q' // default to queen for simplicity
        });

        if (move) {
            selectedSquare = null;
            addMoveToHistory(move);
            renderBoard();
            
            if (!game.game_over()) {
                statusElement.innerText = "AI is thinking...";
                setTimeout(makeAIMove, 250);
            }
        } else {
            // Check if clicking another of player's own pieces
            const piece = game.get(pos);
            if (piece && piece.color === 'w') {
                selectedSquare = pos;
                renderBoard();
            }
        }
    } else {
        const piece = game.get(pos);
        if (piece && piece.color === 'w') {
            selectedSquare = pos;
            renderBoard();
        }
    }
}

function updateStatus() {
    let status = '';
    const turn = game.turn() === 'w' ? 'White' : 'Black';

    if (game.in_checkmate()) {
        status = `Game Over: ${turn === 'White' ? 'Black' : 'White'} wins by Checkmate!`;
    } else if (game.in_draw()) {
        status = 'Game Over: Draw!';
    } else if (game.in_check()) {
        status = `${turn} is in Check!`;
    } else {
        status = `${turn}'s turn`;
    }
    statusElement.innerText = status;
}

function addMoveToHistory(move) {
    const li = document.createElement('li');
    li.innerText = `${move.color === 'w' ? 'W' : 'B'}: ${move.san}`;
    moveListElement.prepend(li);
}

// AI Logic
function evaluateBoard(game) {
    let totalEvaluation = 0;
    const board = game.board();

    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const piece = board[r][c];
            if (piece) {
                // Base value
                let value = weights[piece.type];
                
                // Position bonus (simple center control)
                if (piece.type === 'p') {
                    const row = piece.color === 'w' ? 7 - r : r;
                    const col = c;
                    // Pawns get bonus for advancing
                    value += (row * 2);
                    // Center bonus
                    if (col >= 2 && col <= 5 && row >= 2 && row <= 5) value += 5;
                }

                totalEvaluation += (piece.color === 'w' ? -value : value);
            }
        }
    }
    return totalEvaluation;
}

function minimax(game, depth, alpha, beta, isMaximizing) {
    if (game.game_over()) {
        if (game.in_checkmate()) {
            return isMaximizing ? -9999 : 9999;
        }
        return 0;
    }

    if (depth === 0) {
        return evaluateBoard(game);
    }

    const moves = game.moves();

    if (isMaximizing) {
        let bestEval = -Infinity;
        for (const move of moves) {
            game.move(move);
            const evaluation = minimax(game, depth - 1, alpha, beta, false);
            game.undo();
            bestEval = Math.max(bestEval, evaluation);
            alpha = Math.max(alpha, bestEval);
            if (beta <= alpha) break;
        }
        return bestEval;
    } else {
        let bestEval = Infinity;
        for (const move of moves) {
            game.move(move);
            const evaluation = minimax(game, depth - 1, alpha, beta, true);
            game.undo();
            bestEval = Math.min(bestEval, evaluation);
            beta = Math.min(beta, bestEval);
            if (beta <= alpha) break;
        }
        return bestEval;
    }
}

function makeAIMove() {
    const depth = parseInt(difficultySelect.value);
    const moves = game.moves();
    
    if (moves.length === 0) return;

    let bestMove = null;
    let bestValue = -Infinity;

    // Sort moves to help pruning (captures first)
    moves.sort((a, b) => {
        if (a.includes('x') && !b.includes('x')) return -1;
        if (!a.includes('x') && b.includes('x')) return 1;
        return 0;
    });

    for (const move of moves) {
        game.move(move);
        const boardValue = minimax(game, depth - 1, -Infinity, Infinity, false);
        game.undo();

        if (boardValue > bestValue) {
            bestValue = boardValue;
            bestMove = move;
        }
    }

    const moveResult = game.move(bestMove);
    addMoveToHistory(moveResult);
    renderBoard();
}

resetBtn.addEventListener('click', () => {
    game.reset();
    moveListElement.innerHTML = '';
    selectedSquare = null;
    renderBoard();
});

renderBoard();
