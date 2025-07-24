
const User = require("../models/User");

 const getDescendantIds = async (userId) => {
   const directDescendants = await User.find({ createrid: userId });
   const descendantIds = directDescendants.map(user => user);

   for (const descendant of directDescendants) {
       const subDescendants = await getDescendantIds(descendant._id);
       descendantIds.push(...subDescendants);
   }

   return descendantIds;
 };

 let OWNER_ACCESS_OF_USER_CREATIONS = ["Partner","SuperAgent","Agent", "User"]
 let PARTNER_ACCESS_OF_USER_CREATIONS = ["SuperAgent","Agent", "User"]
 let SUPER_AGENT_ACCESS_OF_USER_CREATIONS = ["Agent", "User"]
 let AGENT_ACCESS_OF_USER_CREATIONS = [ "User"]
const ROLE_BASE_ACCESS_FOR_USER_REGISTERATION = (userRole, roleForCreation) => {
  if (userRole === "Owner") {
    return OWNER_ACCESS_OF_USER_CREATIONS.includes(roleForCreation) ? true :false
  }
   if (userRole === "Partner") {
    return PARTNER_ACCESS_OF_USER_CREATIONS.includes(roleForCreation) ? true :false
   }
   if (userRole === "SuperAgent") {
    return SUPER_AGENT_ACCESS_OF_USER_CREATIONS.includes(roleForCreation) ? true :false
   }
   if (userRole === "Agent") {
    return AGENT_ACCESS_OF_USER_CREATIONS.includes(roleForCreation) ? true :false
   }
  return  false
 }

const GET_ODD_STATUS_STRING = (status) => {
  if (status === 0 || status === "0") {
    return "Running"
  } else if (status === 1 || status === "1")
  {
    return "Lost" 
  }else if (status === 2 || status === "2")
  {
    return "Won" 
  }else if (status === 3 || status === "3")
  {
    return "Void" 
  }else if (status === 4 || status === "4")
  {
    return "Cancelled" 
  }else if (status === 5 ||status === "5")
  {
    return "Rejected" 
  }else if (status === 6 || status === "6")
  {
    return "Cashsout" 
  }else return status
}
module.exports = {getDescendantIds,ROLE_BASE_ACCESS_FOR_USER_REGISTERATION,GET_ODD_STATUS_STRING};