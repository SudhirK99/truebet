const User = require('../models/User');

// Helper function to get roles below a given role
const getRolesBelow = (role) => {
    const hierarchy = ['Owner', 'Partner', 'SuperAgent', 'Agent', 'User'];
    const roleIndex = hierarchy.indexOf(role);
    return hierarchy.slice(roleIndex + 1);
};

// Helper function to calculate network balance
const calculateNetworkBalance = async (userId) => {
    const user = await User.findById(userId);
    if (!user) return 0;

    const rolesBelow = getRolesBelow(user.role);
    const networkUsers = await User.find({
        $or: [
            { createrid: userId },
            { createrid: { $in: await getDescendantIds(userId) } }
        ],
        role: { $in: rolesBelow }
    });

    return networkUsers.reduce((sum, user) => sum + user.balance, 0);
};


async function getDownlineUsers(userId) {
    const users = await User.find({ createrid: userId });
    let allUsers = [...users];

    for (const user of users) {
        const downlineUsers = await getDownlineUsers(user._id);
        allUsers = allUsers.concat(downlineUsers);
    }

    return allUsers;
}
// // Controller function
// const getUserBalance = async (req, res) => {
//     try {
//         const { type,userId } = req.query; // User type to fetch
//             const callerId = req.user.id; // Assuming JWT middleware sets req.user   
//         const targetUserId = userId
//         let loggedInUserTree = await getDownlineUsers(callerId)
//         if (targetUserId && !loggedInUserTree.find(item => item?._id?.toString() === targetUserId?.toString())) {
//             return res.status(404).json({ error: "User not in loggedin user tree" });
//         }

//         // Get caller's information
//         const caller = await User.findById(callerId);
//         if (!caller) {
//             return res.status(404).json({ message: 'Caller not found' });
//         }

//         // Validate if caller can access requested user type
//         const hierarchy = ['Owner', 'Partner', 'SuperAgent', 'Agent', 'User'];
//         const callerRoleIndex = hierarchy.indexOf(caller.role);
//         const requestedRoleIndex = hierarchy.indexOf(type);

//         if (requestedRoleIndex <= callerRoleIndex) {
//             return res.status(403).json({
//                 message: 'You cannot access users of this type'
//             });
//         }

//         // Find users of requested type created by caller or their network

//         let users= []
//         if (userId) {
//             users = await User.find({
//             role: type,
//             $or: [
//                 { _id: userId },
//                 { createrid: { $in: await getDescendantIds(userId) } }
//             ]
//         }).populate('createrid', 'username');
//         } else {
//             users = await User.find({
//                 role: type,
//                 $or: [
//                     { createrid: callerId },
//                     { createrid: { $in: await getDescendantIds(callerId) } }
//                 ]
//             }).populate('createrid', 'username');
//         }

//         // Calculate network balance for each user
//         const usersWithNetworkBalance = await Promise.all(
//           users.map(async (user) => {
//                 const networkBalance = await calculateNetworkBalance(user._id);
//                 return {
//                     name: user.username,
//                     createdBy: user.createrid ? user.createrid.username : 'Unknown',
//                     balance: user.balance,
//                     id: user.id,
//                     networkBalance
//                 };
//             })
//         );

//         res.json(usersWithNetworkBalance);

//     } catch (error) {
//         console.error('Error fetching users:', error);
//         res.status(500).json({
//             message: 'Internal server error',
//             error: error.message
//         });
//     }
// };


const fetchingTheDownlineUsers = async (userId) => {
    // Cache to avoid re-fetching the same users
    const fetchedUsers = new Map();

    async function fetchUserTreeRecursive(currentUserId) {
        if (fetchedUsers.has(currentUserId.toString())) {
            return [];
        }

        const directDescendants = await User.find({ createrid: currentUserId });
        const allUsers = [...directDescendants];
        fetchedUsers.set(currentUserId.toString(), true);

        // Process each direct descendant
        for (const descendant of directDescendants) {
            const subDescendants = await fetchUserTreeRecursive(descendant._id);
            allUsers.push(...subDescendants);
        }

        return allUsers;
    }

    // Start the recursive process
    const result = await fetchUserTreeRecursive(userId);
    return result;
};

const getUserBalance = async (req, res) => {
    try {
        const { type, userId } = req.query; // User type to fetch
        const callerId = req.user.id; // Assuming JWT middleware sets req.user   

        // Get all users in the logged-in user's downline tree
        let loggedInUserTree = await fetchingTheDownlineUsers(callerId);
        const treeUserIds = loggedInUserTree.map(user => user._id.toString());

        // Get caller's information
        const caller = await User.findById(callerId);
        if (!caller) {
            return res.status(404).json({ message: 'Caller not found' });
        }

        // Validate if caller can access requested user type
        const hierarchy = ['Owner', 'Partner', 'SuperAgent', 'Agent', 'User'];
        const callerRoleIndex = hierarchy.indexOf(caller.role);

        // Initialize users array
        let users = [];

        if (userId) {
            // Check if target user is in logged-in user's tree
            if (!treeUserIds.includes(userId.toString())) {
                return res.status(404).json({ error: "User not in logged-in user's tree" });
            }

            // Get the specific user
            const user = await User.findById(userId).populate('createrid', 'username');
            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }

            // Check role access if type is specified
            if (type) {
                const requestedRoleIndex = hierarchy.indexOf(type);
                if (user.role !== type) {
                    return res.status(400).json({ message: 'User is not of the requested type' });
                }
                if (requestedRoleIndex <= callerRoleIndex) {
                    return res.status(403).json({ message: 'You cannot access users of this type' });
                }
            }

            users = [user];
        } else if (type) {
            // Validate if caller can access requested role type
            const requestedRoleIndex = hierarchy.indexOf(type);
            if (requestedRoleIndex <= callerRoleIndex) {
                return res.status(403).json({ message: 'You cannot access users of this type' });
            }

            // Filter users by role and ensure they're in the logged-in user's tree
            users = await User.find({
                _id: { $in: treeUserIds },
                role: type
            }).populate('createrid', 'username');
        } else {
            // Get all users in the logged-in user's tree (excluding the logged-in user)
            users = await User.find({
                _id: { $in: treeUserIds, $ne: callerId }
            }).populate('createrid', 'username');
        }

        // Calculate network balance for each user
        const usersWithNetworkBalance = await Promise.all(
            users.map(async (user) => {
                const networkBalance = await calculateNetworkBalance(user._id);
                return {
                    name: user.username,
                    createdBy: user.createrid ? user.createrid.username : 'Unknown',
                    balance: user.balance,
                    creatorId: user.createrid,
                    id: user._id,
                    role: user.role,
                    networkBalance
                };
            })
        );

        res.json(usersWithNetworkBalance);

    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({
            message: 'Internal server error',
            error: error.message
        });
    }
};
// Single endpoint that returns complete hierarchy data
const getUserHierarchy = async (req, res) => {
    try {
        const callerId = req.user.id;

        // Get caller's information
        const caller = await User.findById(callerId);
        if (!caller) {
            return res.status(404).json({ message: 'Caller not found' });
        }

        // Get all users EXCEPT the caller
        let allUsers = await User.find({ _id: { $ne: callerId } }).lean();

        console.log('Caller ID:', callerId);
        console.log('Caller role:', caller.role);
        console.log('Total users excluding caller:', allUsers.length);

        if (!allUsers || allUsers.length === 0) {
            return res.status(200).json({
                success: true,
                data: {
                    hierarchy: [],
                    totalUsers: 0,
                    callerRole: caller.role
                }
            });
        }

        // Get only direct children of the caller as root nodes
        const rootUsers = allUsers.filter(user =>
            user.createrid && user.createrid.toString() === callerId
        );

        console.log('Direct children of caller:', rootUsers.length);

        // Build the complete hierarchical tree structure
        const hierarchyTree = await buildCompleteHierarchy(rootUsers, allUsers);

        console.log('Final hierarchy length:', hierarchyTree.length);

        res.status(200).json({
            success: true,
            data: {
                hierarchy: hierarchyTree,
                totalUsers: allUsers.length,
                callerRole: caller.role
            }
        });

    } catch (error) {
        console.error('Error fetching user hierarchy:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while fetching user hierarchy',
            error: error.message
        });
    }
};

// Build complete hierarchy with all relationships based on createrid
const buildCompleteHierarchy = async (rootUsers, allUsers) => {
    const result = [];
    const processedIds = new Set(); // Track processed users to prevent duplicates

    console.log('Building hierarchy from root users:', rootUsers.length);

    // Process each root user
    for (const rootUser of rootUsers) {
        await addUserWithDescendants(rootUser, allUsers, 0, result, processedIds);
    }

    console.log('Final result length:', result.length);
    return result;
};

// Recursively add user and their descendants
const addUserWithDescendants = async (user, allUsers, level, result, processedIds) => {
    const userId = user._id.toString();

    // Skip if already processed to prevent duplicates
    if (processedIds.has(userId)) {
        console.log(`Skipping duplicate user: ${user.username} (${userId})`);
        return;
    }

    processedIds.add(userId);
    console.log(`Processing user: ${user.username} (${userId}) at level ${level}`);

    // Find children based on createrid field
    const children = allUsers.filter(u =>
        u.createrid && u.createrid.toString() === userId
    );

    const hasChildren = children.length > 0;

    // Create user row with hierarchy information
    const userRow = {
        id: userId,
        level: `L${level}`,
        levelNumber: level,
        userType: getUserTypeIcon(user.role),
        username: user.username,
        email: user.email || '',
        role: user.role,
        balance: `TND ${parseFloat(user.balance || 0).toFixed(2)}`,
        credit: `TND ${parseFloat(user.credit || 0).toFixed(2)}`,
        status: user.status || 'active',
        hasChildren: hasChildren,
        parentId: user.createrid ? user.createrid.toString() : null,
        isVisible: level === 0, // Only root level visible initially
        isExpanded: false,
        childrenIds: children.map(child => child._id.toString())
    };

    result.push(userRow);

    // Sort children by username
    children.sort((a, b) => a.username.localeCompare(b.username));

    // Recursively add descendants
    for (const child of children) {
        await addUserWithDescendants(child, allUsers, level + 1, result, processedIds);
    }
};

// Helper function to get user type icon based on role
const getUserTypeIcon = (role) => {
    const iconMap = {
        'Owner': '👑',
        'Partner': '👥',
        'SuperAgent': '🔧',
        'Agent': '👤',
        'User': '👤'
    };
    return iconMap[role] || '👤';
};
module.exports = {
    getUserBalance,
    getUserHierarchy,
    // expandHierarchyNode,
    // collapseHierarchyNode
};