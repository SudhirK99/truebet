const { Server } = require("socket.io");
let io;
const initSocket = (server,User,jwt) => {
  io = new Server(server, {
    cors: {
      origin:  process.env.SOCKET_CORS_ORIGINS ? process.env.SOCKET_CORS_ORIGINS.split(",") : [],
      methods: ["GET", "POST"],
      credentials: true,
    },
    pingTimeout: 30000, // Timeout before disconnecting inactive clients
    pingInterval: 10000, // Interval for sending pings to check connection
  });
  
  
  io.on("connection", (socket) => {
  
    // Handle balance fetch request
    socket.on("getbalance", async (data) => {
      try {
        const { token } = data;
        jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
          if (err) {
            console.error("Invalid token:", err.message);
            return socket.emit("expire", { message: "Session expired. Please reauthenticate." });
          }
  
          const user = await User.findById(decoded.id);
          if (user) {
            socket.emit("balance", { balance: user.balance });
          } else {
            socket.emit("expire", { message: "User session expired." });
          }
        });
      } catch (error) {
        console.error("Error fetching balance:", error.message);
        socket.emit("error", { message: "Failed to fetch balance." });
      }
    });
  
    // Subscribe to balance updates
    socket.on("subscribeToBalanceUpdates", async (data) => {
      try {
        const { token } = data;
        jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
          if (err) {
            console.error("Invalid token:", err.message);
            return socket.emit("expire", { message: "Session expired. Please reauthenticate." });
          }
  
          const userId = decoded.id;
  
          const intervalId = setInterval(async () => {
            try {
              const user = await User.findById(userId);
              if (user) {
                socket.emit("balanceUpdate", { balance: user.balance });
              }
               if (user) {
                socket.emit("bonusUpdate", { bonus_balance: user.bonus_balance });
              }
            } catch (error) {
              console.error("Error in balance updates:", error.message);
            }
          }, 5000); // Adjust interval as required
  
          socket.emit("subscribed", { message: "Successfully subscribed to balance updates." });
  
          // Clear interval on disconnect
          socket.on("disconnect", () => {
            clearInterval(intervalId);
          });
        });
      } catch (error) {
        console.error("Error subscribing to balance updates:", error.message);
        socket.emit("error", { message: "Failed to subscribe to updates." });
      }
    });
  
    // Handle disconnection
    socket.on("disconnect", (reason) => {
    });
  });
}

const getIo = () => {
  if (!io) {
    throw new Error("Socket.IO not initialized");
  }
  return io;
};

module.exports = { initSocket, getIo };