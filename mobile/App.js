import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TextInput, ScrollView, Alert, Dimensions, TouchableOpacity } from 'react-native';
import { Chess } from 'chess.js';

// Configuration (Hardcoded for now as fetching in RN needs network)
const CONFIG = {
  // Replace with actual values from your deployment
  wsUrl: "wss://m20zdx6bi3.execute-api.eu-central-1.amazonaws.com/prod", 
};

const windowWidth = Dimensions.get('window').width;
const boardSize = windowWidth - 20;
const squareSize = boardSize / 8;

export default function App() {
  const [game, setGame] = useState(new Chess());
  const [fen, setFen] = useState(game.fen());
  const [status, setStatus] = useState('Disconnected');
  const [ws, setWs] = useState(null);
  const [gameId, setGameId] = useState('');
  const [inputGameId, setInputGameId] = useState('');
  const [gamesList, setGamesList] = useState([]);
  const [view, setView] = useState('home'); // home, game, list
  const [myColor, setMyColor] = useState(null); // 'w' or 'b'
  const [selectedSquare, setSelectedSquare] = useState(null);

  const wsRef = useRef(null);

  useEffect(() => {
    connectWebSocket();
    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  const connectWebSocket = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

    setStatus('Connecting...');
    const socket = new WebSocket(CONFIG.wsUrl);
    wsRef.current = socket;

    socket.onopen = () => {
      setStatus('Connected');
      setWs(socket);
      console.log('Connected to WebSocket');
    };

    socket.onclose = () => {
      setStatus('Disconnected');
      setWs(null);
      console.log('Disconnected');
    };

    socket.onerror = (e) => {
      setStatus('Error');
      console.error('WebSocket Error', e.message);
    };

    socket.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        handleMessage(msg);
      } catch (err) {
        console.error('Error parsing message', err);
      }
    };
  };

  const handleMessage = (msg) => {
    console.log('Received:', msg);
    if (msg.action === 'gameCreated') {
      setGameId(msg.gameId);
      setMyColor('w');
      // Reset game
      const newGame = new Chess();
      setGame(newGame);
      setFen(newGame.fen());
      setView('game');
      Alert.alert('Game Created', `ID: ${msg.gameId}`);
    } else if (msg.action === 'gameStarted') {
      setGameId(msg.gameId);
      setMyColor(msg.color);
      const newGame = new Chess(); 
      // If there is fen in msg, use it? Usually start fen.
      setGame(newGame);
      setFen(newGame.fen());
      setView('game');
      Alert.alert('Game Started', `You are ${msg.color === 'w' ? 'White' : 'Black'}`);
    } else if (msg.action === 'opponentMove') {
      try {
        // If fen is provided, use it directly to ensure sync
        if (msg.fen) {
           const newGame = new Chess(msg.fen);
           setGame(newGame);
           setFen(newGame.fen());
        } else {
           // Fallback if no FEN, try to apply move
           const newGame = new Chess(game.fen());
           newGame.move(msg.move);
           setGame(newGame);
           setFen(newGame.fen());
        }
      } catch (e) {
          console.error("Error applying opponent move", e);
          Alert.alert("Sync Error", "Game state out of sync.");
      }
    } else if (msg.action === 'gamesList') {
      setGamesList(msg.games || []);
    } else if (msg.error) {
      Alert.alert('Error', msg.error);
    }
  };

  const createGame = () => {
    if (ws) ws.send(JSON.stringify({ action: 'createGame' }));
  };

  const joinGame = (id) => {
    if (!id) return;
    if (ws) ws.send(JSON.stringify({ action: 'joinGame', gameId: id }));
  };

  const listGames = () => {
    if (ws) {
      ws.send(JSON.stringify({ action: 'listGames' }));
      setView('list');
    }
  };

  const handleSquarePress = (square) => {
    // Basic turn checking
    if (myColor && game.turn() !== myColor) return;

    if (selectedSquare === square) {
      setSelectedSquare(null);
      return;
    }

    if (selectedSquare) {
      try {
        const move = {
            from: selectedSquare,
            to: square,
            promotion: 'q'
        };
        const tempGame = new Chess(game.fen());
        const result = tempGame.move(move);
        
        if (result) {
          setGame(tempGame);
          setFen(tempGame.fen());
          setSelectedSquare(null);
          
          if (ws) {
              ws.send(JSON.stringify({
                  action: 'move',
                  gameId,
                  move: result.san,
                  fen: tempGame.fen()
              }));
          }
        } else {
            // Invalid move, select new piece if own color
            const piece = game.get(square);
            if (piece && piece.color === game.turn()) {
                setSelectedSquare(square);
            } else {
                setSelectedSquare(null);
            }
        }
      } catch (e) {
        setSelectedSquare(null);
      }
    } else {
      const piece = game.get(square);
      if (piece && piece.color === game.turn()) {
        setSelectedSquare(square);
      }
    }
  };

  const renderBoard = () => {
    const board = game.board();
    const rows = [];
    
    for (let r = 0; r < 8; r++) {
      const cols = [];
      for (let c = 0; c < 8; c++) {
        const square = board[r][c];
        const isDark = (r + c) % 2 === 1;
        const file = String.fromCharCode(97 + c);
        const rank = 8 - r;
        const squareName = `${file}${rank}`;
        const isSelected = selectedSquare === squareName;

        let pieceSymbol = '';
        let pieceColor = '#000';
        
        if (square) {
            // Mapping for display
            const whiteMap = { p: '♙', r: '♖', n: '♘', b: '♗', q: '♕', k: '♔' };
            const blackMap = { p: '♟', r: '♜', n: '♞', b: '♝', q: '♛', k: '♚' };
            
            if (square.color === 'w') {
                 pieceSymbol = whiteMap[square.type];
                 pieceColor = '#fff'; // White pieces usually white
            } else {
                 pieceSymbol = blackMap[square.type];
                 pieceColor = '#000';
            }
        }

        // Labels
        const rankLabel = (c === 0) ? (
            <Text style={[styles.rankLabel, { color: isDark ? '#F0D9B5' : '#B58863' }]}>
                {rank}
            </Text>
        ) : null;

        const fileLabel = (r === 7) ? (
            <Text style={[styles.fileLabel, { color: isDark ? '#F0D9B5' : '#B58863' }]}>
                {file}
            </Text>
        ) : null;

        cols.push(
          <TouchableOpacity
            key={squareName}
            style={[
              styles.square,
              isDark ? styles.darkSquare : styles.lightSquare,
              isSelected ? styles.selectedSquare : null
            ]}
            onPress={() => handleSquarePress(squareName)}
          >
            {rankLabel}
            {fileLabel}
            <Text style={[styles.piece, { color: pieceColor }]}>
              {pieceSymbol}
            </Text>
          </TouchableOpacity>
        );
      }
      rows.push(<View key={r} style={styles.row}>{cols}</View>);
    }
    return <View style={styles.board}>{rows}</View>;
  };

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Chess v0.1</Text>
      <Text style={styles.status}>Status: {status}</Text>

      {view === 'home' && (
        <View style={styles.menu}>
          <TouchableOpacity style={styles.button} onPress={createGame}>
            <Text style={styles.buttonText}>Create Game</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.button} onPress={listGames}>
             <Text style={styles.buttonText}>List Games</Text>
          </TouchableOpacity>

          <Text style={styles.subHeader}>Join by ID:</Text>
          <TextInput
            style={styles.input}
            placeholder="Game ID"
            value={inputGameId}
            onChangeText={setInputGameId}
          />
          <TouchableOpacity style={styles.button} onPress={() => joinGame(inputGameId)}>
             <Text style={styles.buttonText}>Join</Text>
          </TouchableOpacity>
        </View>
      )}

      {view === 'list' && (
        <View style={styles.listContainer}>
          <Text style={styles.subHeader}>Available Games</Text>
          <ScrollView>
            {gamesList.map((g, i) => (
              <View key={i} style={styles.listItem}>
                 <Text>Game {g.gameId}</Text>
                 <TouchableOpacity style={styles.smallButton} onPress={() => joinGame(g.gameId)}>
                    <Text style={styles.buttonText}>Join</Text>
                 </TouchableOpacity>
              </View>
            ))}
            {gamesList.length === 0 && <Text style={{textAlign: 'center', marginTop: 20}}>No games found.</Text>}
          </ScrollView>
          <TouchableOpacity style={styles.button} onPress={() => setView('home')}>
             <Text style={styles.buttonText}>Back</Text>
          </TouchableOpacity>
        </View>
      )}

      {view === 'game' && (
        <View style={styles.gameContainer}>
          <Text style={styles.gameInfo}>
            Game ID: {gameId} | You: {myColor === 'w' ? 'White' : 'Black'}
          </Text>
          <Text style={styles.gameInfo}>
            Turn: {game.turn() === 'w' ? 'White' : 'Black'}
          </Text>
          
          {renderBoard()}

          <TouchableOpacity style={styles.button} onPress={() => setView('home')}>
             <Text style={styles.buttonText}>Leave Game</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 50,
  },
  header: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  status: {
    marginBottom: 20,
    color: 'gray',
  },
  menu: {
    width: '80%',
    alignItems: 'center',
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 8,
    marginVertical: 10,
    width: '100%',
    alignItems: 'center',
  },
  smallButton: {
    backgroundColor: '#007AFF',
    padding: 8,
    borderRadius: 4,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    padding: 10,
    width: '100%',
    marginBottom: 10,
    borderRadius: 5,
  },
  subHeader: {
    fontSize: 18,
    marginTop: 20,
    marginBottom: 10,
    fontWeight: 'bold',
  },
  listContainer: {
    width: '90%',
    flex: 1,
  },
  listItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    alignItems: 'center',
  },
  gameContainer: {
    alignItems: 'center',
  },
  gameInfo: {
    marginBottom: 5,
    fontSize: 16,
  },
  board: {
    width: boardSize,
    height: boardSize,
    borderWidth: 1,
    borderColor: '#000',
    backgroundColor: '#ccc',
  },
  row: {
    flexDirection: 'row',
  },
  square: {
    width: squareSize,
    height: squareSize,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lightSquare: {
    backgroundColor: '#F0D9B5',
  },
  darkSquare: {
    backgroundColor: '#B58863',
  },
  selectedSquare: {
    backgroundColor: 'rgba(255, 255, 0, 0.5)',
  },
  piece: {
    fontSize: squareSize * 0.7,
    fontWeight: 'bold',
  },
  rankLabel: {
    position: 'absolute',
    left: 2,
    top: 2,
    fontSize: 10,
    fontWeight: 'bold',
  },
  fileLabel: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    fontSize: 10,
    fontWeight: 'bold',
  },
});
