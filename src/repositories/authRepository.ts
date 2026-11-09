import initialUsers from "../data/users.json";
import { storageService } from "../services/storageService";
import type {
  BankDatabase,
  Client,
  Loan,
  LoginCredentials,
  Payment,
  User,
  UserRecord,
} from "../types/auth";

const DATABASE_KEY = "bank_database";
const SESSION_KEY = "app_session";

const seedUsers = initialUsers as UserRecord[];

const makeId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createInitialDatabase = (): BankDatabase => {
  const usuarios = seedUsers;
  const clientes: Client[] = usuarios
    .filter((user) => user.role === "USUARIO")
    .map((user) => ({
      id_cliente: `cliente-${user.id}`,
      nombre: user.name.split(" ")[0] || user.name,
      apellido: user.name.split(" ").slice(1).join(" ") || "Prueba",
      ci: user.carnet,
      telefono: user.phone || "70000000",
      direccion: user.address || "Sucre, Bolivia",
      correo: user.email || "usuario@demo.com",
      userId: user.id,
    }));

  return { usuarios, clientes, prestamos: [], pagos: [] };
};

const getDatabase = (): BankDatabase => {
  const stored = storageService.get<BankDatabase>(DATABASE_KEY);
  if (stored) return stored;

  const database = createInitialDatabase();
  storageService.set(DATABASE_KEY, database);
  return database;
};

const saveDatabase = (database: BankDatabase) => {
  storageService.set(DATABASE_KEY, database);
};

const toSessionUser = (user: UserRecord): User => ({
  id: user.id,
  name: user.name,
  carnet: user.carnet,
  role: user.role,
  email: user.email,
  phone: user.phone,
  address: user.address,
});

export const authRepository = {
  login(credentials: LoginCredentials): User | null {
    const database = getDatabase();
    const foundUser = database.usuarios.find(
      (user) =>
        user.carnet === credentials.carnet.trim() &&
        user.password === credentials.password
    );

    if (!foundUser) return null;

    const sessionUser = toSessionUser(foundUser);
    storageService.set<User>(SESSION_KEY, sessionUser);
    return sessionUser;
  },

  register(data: {
    name: string;
    carnet: string;
    password: string;
    email: string;
    phone: string;
    address: string;
  }): { user: User | null; error?: string } {
    const database = getDatabase();
    const carnet = data.carnet.trim();

    if (database.usuarios.some((user) => user.carnet === carnet)) {
      return { user: null, error: "Ya existe un usuario con ese carnet." };
    }

    const id = makeId("user");
    const newUser: UserRecord = {
      id,
      name: data.name.trim(),
      carnet,
      password: data.password,
      role: "USUARIO",
      email: data.email.trim(),
      phone: data.phone.trim(),
      address: data.address.trim(),
    };

    const client: Client = {
      id_cliente: makeId("cliente"),
      nombre: data.name.trim().split(" ")[0] || data.name.trim(),
      apellido: data.name.trim().split(" ").slice(1).join(" ") || "Usuario",
      ci: carnet,
      telefono: data.phone.trim(),
      direccion: data.address.trim(),
      correo: data.email.trim(),
      userId: id,
    };

    database.usuarios.push(newUser);
    database.clientes.push(client);
    saveDatabase(database);

    const sessionUser = toSessionUser(newUser);
    storageService.set<User>(SESSION_KEY, sessionUser);
    return { user: sessionUser };
  },

  logout(): void {
    storageService.remove(SESSION_KEY);
  },

  getCurrentUser(): User | null {
    return storageService.get<User>(SESSION_KEY);
  },

  isAuthenticated(): boolean {
    return this.getCurrentUser() !== null;
  },

  getDatabase,

  getClient(userId: string): Client | null {
    return getDatabase().clientes.find((client) => client.userId === userId) || null;
  },

  getLoans(userId: string): Loan[] {
    const database = getDatabase();
    const client = database.clientes.find((item) => item.userId === userId);
    if (!client) return [];
    return database.prestamos.filter((loan) => loan.id_cliente === client.id_cliente);
  },

  getPayments(userId: string): Payment[] {
    const database = getDatabase();
    const loans = this.getLoans(userId);
    const loanIds = new Set(loans.map((loan) => loan.id_prestamo));
    return database.pagos.filter((payment) => loanIds.has(payment.id_prestamo));
  },

  createLoan(userId: string, amount: number, months: number): Loan | null {
    const database = getDatabase();
    const client = database.clientes.find((item) => item.userId === userId);
    if (!client || amount <= 0 || months <= 0) return null;

    const currentLoans = database.prestamos.filter(
      (loan) =>
        loan.id_cliente === client.id_cliente &&
        (loan.estado === "ACTIVO" || loan.estado === "PENDIENTE")
    );
    const committedBalance = currentLoans.reduce((sum, loan) => sum + loan.saldo, 0);
    const available = Math.max(0, 20000 - committedBalance);
    if (amount > available) return null;

    const annualInterest = 0.12;
    const total = amount * (1 + annualInterest * (months / 12));
    const monthly = total / months;

    const loan: Loan = {
      id_prestamo: makeId("prestamo"),
      id_cliente: client.id_cliente,
      monto: amount,
      fecha_prestamo: new Date().toISOString(),
      plazo_meses: months,
      interes: annualInterest * 100,
      saldo: Number(total.toFixed(2)),
      estado: "PENDIENTE",
      cuota_mensual: Number(monthly.toFixed(2)),
    };

    database.prestamos.push(loan);
    saveDatabase(database);
    return loan;
  },

  payLoan(userId: string, loanId: string, amount: number, method: string): Payment | null {
    const database = getDatabase();
    const loan = database.prestamos.find((item) => item.id_prestamo === loanId);
    if (!loan || loan.estado !== "ACTIVO" || amount <= 0 || amount > loan.saldo) return null;

    const userLoans = this.getLoans(userId);
    if (!userLoans.some((item) => item.id_prestamo === loanId)) return null;

    const payment: Payment = {
      id_pago: makeId("pago"),
      id_prestamo: loanId,
      monto_pago: Number(amount.toFixed(2)),
      fecha_pago: new Date().toISOString(),
      metodo_pago: method,
    };

    loan.saldo = Number((loan.saldo - amount).toFixed(2));
    if (loan.saldo <= 0) {
      loan.saldo = 0;
      loan.estado = "PAGADO";
    }

    database.pagos.push(payment);
    saveDatabase(database);
    return payment;
  },

  getAvailableCredit(userId: string): number {
    const committedBalance = this.getLoans(userId)
      .filter((loan) => loan.estado === "ACTIVO" || loan.estado === "PENDIENTE")
      .reduce((sum, loan) => sum + loan.saldo, 0);
    return Math.max(0, 20000 - committedBalance);
  },

  getAllClients(): Client[] {
    return [...getDatabase().clientes];
  },

  getAllLoans(): Loan[] {
    return [...getDatabase().prestamos];
  },

  getAllPayments(): Payment[] {
    return [...getDatabase().pagos];
  },

  getAllUsers(): User[] {
    return getDatabase().usuarios.map(toSessionUser);
  },

  addClient(data: {
    name: string;
    carnet: string;
    password: string;
    email: string;
    phone: string;
    address: string;
  }): { client: Client | null; error?: string } {
    const database = getDatabase();
    const carnet = data.carnet.trim();
    if (!data.name.trim() || !carnet || data.password.length < 6) {
      return { client: null, error: "Completa los datos y usa una contraseña de al menos 6 caracteres." };
    }
    if (database.usuarios.some((user) => user.carnet === carnet)) {
      return { client: null, error: "Ya existe una cuenta con ese carnet." };
    }

    const userId = makeId("user");
    const user: UserRecord = {
      id: userId,
      name: data.name.trim(),
      carnet,
      password: data.password,
      role: "USUARIO",
      email: data.email.trim(),
      phone: data.phone.trim(),
      address: data.address.trim(),
    };
    const parts = data.name.trim().split(/\s+/);
    const client: Client = {
      id_cliente: makeId("cliente"),
      nombre: parts[0] || "",
      apellido: parts.slice(1).join(" ") || "Usuario",
      ci: carnet,
      telefono: data.phone.trim(),
      direccion: data.address.trim(),
      correo: data.email.trim(),
      userId,
    };
    database.usuarios.push(user);
    database.clientes.push(client);
    saveDatabase(database);
    return { client };
  },

  updateClient(clientId: string, data: Omit<Client, "id_cliente" | "userId">): { ok: boolean; error?: string } {
    const database = getDatabase();
    const client = database.clientes.find((item) => item.id_cliente === clientId);
    if (!client) return { ok: false, error: "No se encontró el cliente." };
    if (database.clientes.some((item) => item.id_cliente !== clientId && item.ci === data.ci.trim())) {
      return { ok: false, error: "Ya existe otro cliente con ese carnet." };
    }
    Object.assign(client, {
      nombre: data.nombre.trim(),
      apellido: data.apellido.trim(),
      ci: data.ci.trim(),
      telefono: data.telefono.trim(),
      direccion: data.direccion.trim(),
      correo: data.correo.trim(),
    });
    const user = database.usuarios.find((item) => item.id === client.userId);
    if (user) {
      user.name = `${client.nombre} ${client.apellido}`.trim();
      user.carnet = client.ci;
      user.phone = client.telefono;
      user.address = client.direccion;
      user.email = client.correo;
    }
    saveDatabase(database);
    return { ok: true };
  },

  deleteClient(clientId: string): boolean {
    const database = getDatabase();
    const client = database.clientes.find((item) => item.id_cliente === clientId);
    if (!client) return false;
    const loanIds = new Set(
      database.prestamos.filter((loan) => loan.id_cliente === clientId).map((loan) => loan.id_prestamo)
    );
    database.pagos = database.pagos.filter((payment) => !loanIds.has(payment.id_prestamo));
    database.prestamos = database.prestamos.filter((loan) => loan.id_cliente !== clientId);
    database.clientes = database.clientes.filter((item) => item.id_cliente !== clientId);
    database.usuarios = database.usuarios.filter((user) => user.id !== client.userId);
    saveDatabase(database);
    return true;
  },

  decideLoan(loanId: string, decision: "ACTIVO" | "RECHAZADO"): boolean {
    const database = getDatabase();
    const loan = database.prestamos.find((item) => item.id_prestamo === loanId);
    if (!loan || loan.estado !== "PENDIENTE") return false;
    loan.estado = decision;
    if (decision === "RECHAZADO") loan.saldo = 0;
    saveDatabase(database);
    return true;
  },

  registerAdminPayment(loanId: string, amount: number, method: string): Payment | null {
    const database = getDatabase();
    const loan = database.prestamos.find((item) => item.id_prestamo === loanId);
    if (!loan || loan.estado !== "ACTIVO" || !Number.isFinite(amount) || amount <= 0 || amount > loan.saldo) {
      return null;
    }
    const payment: Payment = {
      id_pago: makeId("pago"),
      id_prestamo: loanId,
      monto_pago: Number(amount.toFixed(2)),
      fecha_pago: new Date().toISOString(),
      metodo_pago: method,
    };
    loan.saldo = Number((loan.saldo - amount).toFixed(2));
    if (loan.saldo <= 0) {
      loan.saldo = 0;
      loan.estado = "PAGADO";
    }
    database.pagos.push(payment);
    saveDatabase(database);
    return payment;
  },
};
