// Write test/fixtures/contacts.xlsx: two sheets, a phone stored as a number
// (Excel would show it as 3.83441E+11 if read carelessly), accents, a duplicate.
const XLSX = require("../vendor/xlsx.full.min.js");
const path = require("path");
XLSX.set_fs(require("fs"));

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  ["Name", "Email", "Mobile"],
  ["Gresa Morina", "gresa@example.com", 383441234567],
  ["Gresa  Morina", "GRESA@example.com", "+383 44 1234 567"],
  ["Ilir Hoxha", "ilir@example.com", 38349111222],
]), "Customers");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  ["Company", "Email"],
  ["Acme Corp.", "info@acme.com"],
  ["ACME Corporation", "sales@acme.com"],
]), "Suppliers");
XLSX.writeFile(wb, path.join(__dirname, "fixtures", "contacts.xlsx"));
console.log("wrote contacts.xlsx");
