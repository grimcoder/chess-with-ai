const game = new Chess();
const boardElement = document.getElementById('board');
const statusElement = document.getElementById('status');
const moveListElement = document.getElementById('move-list');
const resetBtn = document.getElementById('reset-btn');
const undoBtn = document.getElementById('undo-btn');
const historyBtn = document.getElementById('history-btn');
const onlineBtn = document.getElementById('online-btn');
const modal = document.getElementById('history-modal');
const closeBtn = document.querySelector('.close-btn');
const gamesList = document.getElementById('games-list');
const difficultySelect = document.getElementById('difficulty-select');

// Auth elements
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const gameWrapper = document.getElementById('game-wrapper');
const authContainer = document.getElementById('auth-container');
const userInfo = document.getElementById('user-info');
const userEmailSpan = document.getElementById('user-email');

let isGameSaved = false;

// --- Configuration ---
let COGNITO_DOMAIN;
let CLIENT_ID;
let API_URL;
let WS_URL;
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
        COGNITO_DOMAIN = config.cognitoDomain; 
        CLIENT_ID = config.clientId;
        API_URL = config.apiUrl;
        WS_URL = config.wsUrl;
        
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
let currentGameId = null; // Track current game ID to avoid duplicates
let isOnlineGame = false;
let myColor = null; // 'w' or 'b'
let ws = null; // WebSocket connection

const PIECES = {
    'p': '♟', 'r': '♜', 'n': '♞', 'b': '♝', 'q': '♛', 'k': '♚',
    'P': '♙', 'R': '♖', 'N': '♘', 'B': '♗', 'Q': '♕', 'K': '♔'
};

// WebSocket Logic
function connectWebSocket() {
    return new Promise((resolve, reject) => {
        if (!WS_URL) {
            console.error("WS_URL not set");
            reject("WS_URL not set. Check config.");
            return;
        }

        if (ws && ws.readyState === WebSocket.OPEN) {
            resolve(ws);
            return;
        }

        if (ws && ws.readyState === WebSocket.CONNECTING) {
            // Already connecting, wait for it
            const checkInterval = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    clearInterval(checkInterval);
                    resolve(ws);
                } else if (ws.readyState === WebSocket.CLOSED) {
                    clearInterval(checkInterval);
                    reject("Connection failed");
                }
            }, 100);
            return;
        }

        ws = new WebSocket(WS_URL);

        ws.onopen = () => {
            console.log("Connected to WebSocket");
            statusElement.innerText = "Connected to Server. Ready to play online.";
            resolve(ws);
        };

        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            handleServerMessage(msg);
        };

        ws.onclose = () => {
            console.log("Disconnected from WebSocket");
            statusElement.innerText = "Disconnected from Server.";
        };
        
        ws.onerror = (e) => {
            console.error("WebSocket Error", e);
            reject(e);
        };
    });
}

// Evaluation Tables (simplified)
const weights = { p: 10, n: 30, b: 30, r: 50, q: 90, k: 900 };

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

            if (isOnlineGame && game.turn() === myColor) {
               // Highlight valid moves only if it's my turn
               if (validMoves.some(m => m.to === pos)) {
                   squareDiv.classList.add('highlight');
               }
            } else if (!isOnlineGame) {
                // Highlight valid moves
                if (validMoves.some(m => m.to === pos)) {
                    squareDiv.classList.add('highlight');
                }
            }


            squareDiv.addEventListener('click', () => onSquareClick(pos));
            boardElement.appendChild(squareDiv);
        }
    }
    updateStatus();
}

function handleServerMessage(msg) {
    if (msg.action === 'gameCreated') {
        currentGameId = msg.gameId;
        alert(`Game Created! ID: ${currentGameId}\nShare this ID with your friend.`);
        statusElement.innerText = `Waiting for opponent... (Game ID: ${currentGameId})`;
        myColor = 'w'; // Creator is white
        isOnlineGame = true;
        game.reset();
        renderBoard();
        document.getElementById('multiplayer-menu').style.display = 'none';
    } else if (msg.action === 'gameStarted') {
        currentGameId = msg.gameId;
        statusElement.innerText = `Game Started! You are ${msg.color === 'w' ? 'White' : 'Black'}. White to move.`;
        myColor = msg.color;
        isOnlineGame = true;
        game.reset(); // or msg.fen if resuming
        renderBoard();
        document.getElementById('multiplayer-menu').style.display = 'none';
    } else if (msg.action === 'opponentMove') {
        game.move(msg.move);
        // Add move to history without recreating board?
        addMoveToHistory(game.history({ verbose: true }).pop()); // Add last move
        renderBoard();
        updateStatus();
    } else if (msg.error) {
        alert("Error: " + msg.error);
    }
}

async function createOnlineGame() {
    try {
        await connectWebSocket();
        ws.send(JSON.stringify({ action: 'createGame' }));
    } catch (e) {
        console.error("Connection failed", e);
        alert("Failed to connect to server. Ensure configuration is loaded.");
    }
}

async function joinOnlineGame() {
    const gameId = prompt("Enter Game ID:");
    if (!gameId) return;
    
    try {
        await connectWebSocket();
        ws.send(JSON.stringify({ action: 'joinGame', gameId }));
    } catch (e) {
        console.error("Connection failed", e);
        alert("Failed to connect to server.");
    }
}

function onSquareClick(pos) {
    if (game.game_over()) return;

    // Online Checks
    if (isOnlineGame) {
        if (game.turn() !== myColor) return; // Not my turn
        // Check if piece belongs to me (prevent selecting opponent pieces)
        const piece = game.get(pos);
        if (piece && piece.color !== myColor && !selectedSquare) return;
    }

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
            
            if (isOnlineGame) {
                // Send move to server
                ws.send(JSON.stringify({ 
                    action: 'move', 
                    gameId: currentGameId, 
                    move: move.san, // Store SAN or object
                    fen: game.fen() 
                }));
                 statusElement.innerText = "Opponent's turn...";
            } else {
                if (!game.game_over()) {
                    statusElement.innerText = "AI is thinking...";
                    setTimeout(makeAIMove, 250);
                }
            }
        } else {
            // Check if clicking another of player's own pieces
            const piece = game.get(pos);
            // Allow selection if it's my piece
            if (piece) {
                const isMyPiece = isOnlineGame ? piece.color === myColor : piece.color === 'w'; // In local game user is white
                if (isMyPiece) {
                    selectedSquare = pos;
                    renderBoard();
                }
            }
        }
    } else {
        const piece = game.get(pos);
        if (piece) {
             const isMyPiece = isOnlineGame ? piece.color === myColor : piece.color === 'w';
             if (isMyPiece) {
                selectedSquare = pos;
                renderBoard();
             }
        }
    }
}

function updateStatus() {
    let status = '';
    const turn = game.turn() === 'w' ? 'White' : 'Black';

    if (game.in_checkmate()) {
        const winner = turn === 'White' ? 'Black' : 'White';
        status = `Game Over: ${winner} wins by Checkmate!`;
        if (!isGameSaved) {
            saveGame(winner);
            isGameSaved = true;
        }
    } else if (game.in_draw()) {
        status = 'Game Over: Draw!';
        if (!isGameSaved) {
            saveGame('Draw');
            isGameSaved = true;
        }
    } else if (game.in_check()) {
        status = `${turn} is in Check!`;
    } else {
        status = `${turn}'s turn`;
    }
    statusElement.innerText = status;
}


function addMoveToHistory(move) {
    const li = document.createElement('li');
    li.textContent = `${move.color === 'w' ? 'White' : 'Black'}: ${move.san}`;
    moveListElement.prepend(li);
}

function undoMove() {
     // Prevent undo if AI is thinking (though unlikely to click fast enough)
    if (statusElement.innerText === "AI is thinking...") return;

    // Undo 2-ply (White move + Black response) to get back to White's turn
    if (game.history().length >= 2) {
        // Undo AI
        game.undo();
        if (moveListElement.firstElementChild) moveListElement.removeChild(moveListElement.firstElementChild);
        
        // Undo Player
        game.undo();
        if (moveListElement.firstElementChild) moveListElement.removeChild(moveListElement.firstElementChild);
        
        selectedSquare = null;
        renderBoard();
        isGameSaved = false;
        statusElement.innerText = "White's turn";
    }
}

// AI Logic


resetBtn.addEventListener('click', () => {
    game.reset();
    moveListElement.innerHTML = '';
    selectedSquare = null;
    renderBoard();
});

undoBtn.addEventListener('click', undoMove);

renderBoard();
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
    isGameSaved = false;
    currentGameId = null; // Reset game ID
    statusElement.innerText = "White's turn";
    renderBoard();
});

// --- Game History API ---

async function saveGame(result) {
    if (!API_URL) return;
    const token = localStorage.getItem('chess_auth_token');
    if (!token) return; // Only save for logged-in users

    const gameData = {
        pgn: game.pgn(),
        fen: game.fen(),
        result: result,
        opponent: 'AI',
        gameId: currentGameId // Send current ID if exists
    };

    try {
        const response = await fetch(`${API_URL}games`, {
            method: 'POST',
            headers: {
                'Authorization': token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(gameData)
        });

        if (response.ok) {
            const data = await response.json();
            if (data.gameId) {
                currentGameId = data.gameId; // Store returned ID
            }
        } else {
            console.error("Failed to save game");
        }
    } catch (e) {
        console.error("Error saving game:", e);
    }
}

async function fetchGames() {
    if (!API_URL) return;
    const token = localStorage.getItem('chess_auth_token');
    if (!token) {
        alert("Please login to see your game history.");
        return;
    }

    try {
        const response = await fetch(`${API_URL}games`, {
            method: 'GET',
            headers: {
                'Authorization': token
            }
        });

        if (response.ok) {
            const games = await response.json();
            renderGamesList(games);
            modal.style.display = "block";
        } else {
            console.error("Failed to fetch games");
            alert("Failed to load game history.");
        }
    } catch (e) {
        console.error("Error fetching games:", e);
        alert("Error loading history.");
    }
}

function renderGamesList(games) {
    gamesList.innerHTML = '';
    if (games.length === 0) {
        gamesList.innerHTML = '<li>No games found.</li>';
        return;
    }

    // Sort by timestamp descending
    games.sort((a, b) => b.timestamp - a.timestamp);

    games.forEach(g => {
        const date = new Date(g.timestamp).toLocaleString();
        const li = document.createElement('li');
        // Retrieve result safely
        const resultText = g.result || 'Unknown';
        li.innerHTML = `
            <span>${date} vs ${g.opponent} (${resultText})</span>
            <button class="load-game-btn">Load</button>
        `;
        
        const btn = li.querySelector('.load-game-btn');
        btn.onclick = (e) => {
            e.stopPropagation();
            // Use the closure variable 'g' directly
            loadGamesPgn(g.pgn, g.gameId);
        };
        
        gamesList.appendChild(li);
    });
}

function loadGamesPgn(pgn, gameId) {
    game.load_pgn(pgn);
    renderBoard();
    updateStatus();
    
    // Reconstruct move history list
    moveListElement.innerHTML = '';
    const history = game.history({ verbose: true });
    history.forEach(move => addMoveToHistory(move));
    
    modal.style.display = "none";
    isGameSaved = true; // Loaded games are already saved.
    currentGameId = gameId || null; // Set current game ID
}


historyBtn.addEventListener('click', fetchGames);

if (onlineBtn) {
    onlineBtn.addEventListener('click', () => {
        console.log('Online button clicked');
        const menu = document.getElementById('multiplayer-menu');
        if (menu) {
            menu.style.display = 'block';
        } else {
            console.error('Multiplayer menu not found');
        }
    });
} else {
    console.error('Online button not found');
}

closeBtn.addEventListener('click', () => {
    modal.style.display = "none";
});

window.addEventListener('click', (event) => {
    if (event.target == modal) {
        modal.style.display = "none";
    }
});

renderBoard();
