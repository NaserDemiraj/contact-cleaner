"""Write the CSV fixtures the engine tests use (run once; output is committed)."""
import csv
import os
import random

HERE = os.path.join(os.path.dirname(__file__), "fixtures")
os.makedirs(HERE, exist_ok=True)


def write(name, rows, encoding="utf-8", delimiter=","):
    with open(os.path.join(HERE, name), "w", newline="", encoding=encoding) as f:
        csv.writer(f, delimiter=delimiter).writerows(rows)


# The kinds of mess real lists have.
write("messy.csv", [
    ["Full Name", "Email", "Phone", "Company"],
    ["Arta Berisha", "arta@example.com", "+383 44 123 456", "Kosova Tech"],
    ["  ARTA   berisha ", "Arta@Example.com", "044 123 456", "Kosova Tech"],
    ["arta berisha", "arta@example.com", "+383 44 123 456", "kosova tech"],
    ["", "", "", ""],
    ["Peter Hall", "peter@hall.co.uk", "", "ACME Corp."],
    ["Petra Hall", "petra@hall.co.uk", "", "Acme Corporation"],
    ["Blerim Krasniqi", "N/A", "049 555 777", "-"],
    ["Blerim Krasniqi", "blerim@example", "", ""],
    ["Jane O'Neil", "jane@oneil.ie", "", "O'Neil & Sons"],
    ["Jane ONeil", "jane.oneil@gmail.com", "", "ONeil and Sons"],
    ["Marković, Ana", "ana@markovic.rs", "", ""],
    ["Ana Markovic", "ana@markovic.rs", "", ""],
    ["Unrelated Person", "someone@else.org", "", "Other Ltd", "extra value"],
])

write("semicolon.csv", [
    ["Name", "E-mail", "Amount"],
    ["Müller GmbH", "info@mueller.de", "1,5"],
    ["Mueller GmbH", "info@mueller.de", "2,5"],
    ["Schmidt AG", "kontakt@schmidt.de", "3,0"],
], delimiter=";")

write("cp1250.csv", [
    ["Name", "Email"],
    ["Łukasz Wiśniewski", "lukasz@example.pl"],
    ["Lukasz Wisniewski", "l.w@example.pl"],
    ["Jovana Petrović", "jovana@example.rs"],
    ["Jovana Petrovic", "jovana@example.rs"],
], encoding="cp1250")

write("multiline.csv", [
    ["Name", "Email", "Notes"],
    ["Liridona Gashi", "liri@example.com", "met at fair\nwants a quote, \"urgent\""],
    ["Liridona Gashi", "liri@example.com", "met at fair\nwants a quote, \"urgent\""],
    ["Driton Shala", "driton@example.com", ""],
])

random.seed(7)
first = ["Arta", "Blerim", "Driton", "Elira", "Faton", "Gresa", "Ilir", "Jeta", "Kushtrim",
         "Liridona", "Mark", "Anna", "John", "Maria", "Peter", "Sara"]
last = ["Berisha", "Krasniqi", "Gashi", "Hoxha", "Shala", "Morina", "Smith", "Jones",
        "Brown", "Miller", "Rexhepi", "Kelmendi"]
rows = [["Name", "Email", "Company"]]
for i in range(3000):
    fn, ln = random.choice(first), random.choice(last)
    name = "%s %s" % (fn, ln) if random.random() > .1 else "  %s %s " % (fn.upper(), ln)
    email = "%s.%s%d@example.com" % (fn.lower(), ln.lower(), i % 1200) if random.random() > .05 else "n/a"
    rows.append([name, email, random.choice(["", "Acme", "N/A", "Kosova Tech", "Acme Corp"])])
write("synthetic3000.csv", rows)
print("fixtures written to", HERE)
