require('dotenv').config();
const bcrypt = require('bcrypt');
const saltRounds = 10;
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const { enviarEmailAbertura, enviarEmailStatus } = require('./email');

const app = express();
const PORT = process.env.PORT || 3000;

const whitelist = [
  'http://127.0.0.1:5500',
  'http://localhost:5500',
  'https://colinamultitec.site',
  'https://www.colinamultitec.site'
];

const corsOptions = {
    origin: function (origin, callback) {
        if (whitelist.indexOf(origin) !== -1 || !origin) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    }
};

app.use(cors(corsOptions));
app.use(express.json());

const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

let pool;

app.post('/login', async (req, res) => {
    const { email, senha } = req.body;
    if (!email || !senha) {
        return res.status(400).json({ success: false, message: 'E-mail e senha são obrigatórios.' });
    }
    try {
        const query = `
            SELECT 
                c.colaborador_id, c.nome, c.sobrenome, c.email, c.senha,
                crg.nome AS cargo_nome, crg.acesso_cadastro_cliente, crg.acesso_cadastro_colaborador, 
                crg.acesso_cadastro_servico, crg.ver_manutencao_cliente, crg.editar_manutencao_cliente,
                crg.ver_manutencao_colaborador, crg.editar_manutencao_colaborador, crg.ver_manutencao_servico,
                crg.editar_manutencao_servico, crg.ver_manutencao_cargo, crg.editar_manutencao_cargo
            FROM colaboradores c 
            INNER JOIN cargos crg ON c.cargo_id = crg.cargo_id 
            WHERE c.email = ? AND c.status = 'ativo'
        `;
        const [rows] = await pool.query(query, [email]);

        if (rows.length > 0) {
            const usuario = rows[0];
            const senhaValida = await bcrypt.compare(senha, usuario.senha);

            if (senhaValida) {
                const permissoes = {
                    acesso_cadastro_cliente: usuario.acesso_cadastro_cliente[0] === 1,
                    acesso_cadastro_colaborador: usuario.acesso_cadastro_colaborador[0] === 1,
                    acesso_cadastro_servico: usuario.acesso_cadastro_servico[0] === 1,
                    ver_manutencao_cliente: usuario.ver_manutencao_cliente[0] === 1,
                    editar_manutencao_cliente: usuario.editar_manutencao_cliente[0] === 1,
                    ver_manutencao_colaborador: usuario.ver_manutencao_colaborador[0] === 1,
                    editar_manutencao_colaborador: usuario.editar_manutencao_colaborador[0] === 1,
                    ver_manutencao_servico: usuario.ver_manutencao_servico[0] === 1,
                    editar_manutencao_servico: usuario.editar_manutencao_servico[0] === 1,
                    ver_manutencao_cargo: usuario.ver_manutencao_cargo[0] === 1,
                    editar_manutencao_cargo: usuario.editar_manutencao_cargo[0] === 1
                };
                res.json({
                    success: true, message: 'Login bem-sucedido!',
                    usuario: {
                        id: usuario.colaborador_id,
                        nome: usuario.nome,
                        sobrenome: usuario.sobrenome,
                        email: usuario.email,
                        cargo_nome: usuario.cargo_nome,
                        permissoes: permissoes
                    }
                });
            } else {
                res.status(401).json({ success: false, message: 'Credenciais inválidas.' });
            }
        } else {
            res.status(401).json({ success: false, message: 'Credenciais inválidas.' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

app.delete('/cargos/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const [usageResult] = await pool.query('SELECT COUNT(*) as total FROM colaboradores WHERE cargo_id = ?', [id]);
        
        if (usageResult[0].total > 0) {
            return res.status(409).json({ 
                success: false,
                message: 'Este cargo não pode ser apagado pois está sendo utilizado.'
            });
        }

        const [result] = await pool.query('DELETE FROM cargos WHERE cargo_id = ?', [id]);

        if (result.affectedRows > 0) {
            res.json({ success: true, message: 'Cargo apagado com sucesso!' });
        } else {
            res.status(404).json({ success: false, message: 'Cargo não encontrado.' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

app.post('/cadastrar_colaborador', async (req, res) => {
    const { nome, sobrenome, email, senha, endereco, cargo_id, telefone, cpf } = req.body;

    if (!nome || !sobrenome || !email || !senha || !endereco || !cargo_id || !telefone || !cpf) {
        return res.status(400).json({ success: false, message: 'Todos os campos são obrigatórios.' });
    }

    try {
        const hashedPassword = await bcrypt.hash(senha, saltRounds);
        const [cpfResult] = await pool.query(`SELECT * FROM colaboradores WHERE cpf = ?`, [cpf]);

        if (cpfResult.length > 0) {
            const existingCollaborator = cpfResult[0];
            if (existingCollaborator.status === 'ativo') {
                return res.status(409).json({ success: false, message: 'O CPF informado já está em uso por um colaborador ativo.' });
            }

            const [emailResult] = await pool.query(`SELECT email FROM colaboradores WHERE email = ? AND cpf != ? AND status = 'ativo'`, [email, cpf]);
            if (emailResult.length > 0) {
                return res.status(409).json({ success: false, message: 'O email informado já está em uso por outro colaborador ativo.' });
            }

            await pool.query(`
                UPDATE colaboradores 
                SET nome = ?, sobrenome = ?, email = ?, senha = ?, endereco = ?, cargo_id = ?, telefone = ?, status = 'ativo'
                WHERE cpf = ?`,
                [nome, sobrenome, email, hashedPassword, endereco, cargo_id, telefone, cpf]
            );
            return res.status(200).json({ success: true, message: 'Colaborador inativo foi reativado e atualizado com sucesso!' });
        }

        const [emailResult] = await pool.query(`SELECT email FROM colaboradores WHERE email = ? AND status = 'ativo'`, [email]);
        if (emailResult.length > 0) {
            return res.status(409).json({ success: false, message: 'O email informado já está em uso por um colaborador ativo.' });
        }
        
        await pool.query(`
            INSERT INTO colaboradores (nome, sobrenome, email, senha, endereco, cargo_id, telefone, cpf, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ativo')`,
            [nome, sobrenome, email, hashedPassword, endereco, cargo_id, telefone, cpf]
        );
        res.status(201).json({ success: true, message: 'Colaborador cadastrado com sucesso!' });

    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ success: false, message: 'Erro de duplicidade. O CPF ou Email já pode estar em uso.' });
        }
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

app.post('/cadastrar_cliente', async (req, res) => {
    const { nome, sobrenome, email, data_nascimento, endereco, telefone, cpf } = req.body;
    if (!nome || !sobrenome || !email || !data_nascimento || !cpf) {
        return res.status(400).json({ success: false, message: 'Campos obrigatórios não preenchidos.' });
    }
    try {
        const [cpfResult] = await pool.query('SELECT * FROM clientes WHERE cpf = ?', [cpf]);
        if (cpfResult.length > 0) {
            const existingClient = cpfResult[0];
            if (existingClient.status === 'ativo') {
                return res.status(409).json({ success: false, message: 'O CPF informado já está em uso por um cliente ativo.' });
            }
            const [emailResult] = await pool.query(`SELECT email FROM clientes WHERE email = ? AND cpf != ? AND status = 'ativo'`, [email, cpf]);
            if (emailResult.length > 0) {
                return res.status(409).json({ success: false, message: 'O e-mail informado já está em uso por outro cliente ativo.' });
            }
            await pool.query(`
                UPDATE clientes SET nome = ?, sobrenome = ?, email = ?, data_nascimento = ?, endereco = ?, telefone = ?, status = 'ativo'
                WHERE cpf = ?`,
                [nome, sobrenome, email, data_nascimento, endereco, telefone, cpf]
            );
            return res.status(200).json({ success: true, message: 'Cliente inativo foi reativado e atualizado com sucesso!' });
        } else {
            const [emailResult] = await pool.query(`SELECT email FROM clientes WHERE email = ? AND status = 'ativo'`, [email]);
            if (emailResult.length > 0) {
                return res.status(409).json({ success: false, message: 'O e-mail informado já está em uso por um cliente ativo.' });
            }
            await pool.query(`
                INSERT INTO clientes (nome, sobrenome, email, data_nascimento, endereco, telefone, cpf, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'ativo')`,
                [nome, sobrenome, email, data_nascimento, endereco, telefone, cpf]
            );
            res.status(201).json({ success: true, message: 'Cliente cadastrado com sucesso!' });
        }
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ success: false, message: 'Erro de duplicidade. O CPF ou Email já está em uso.' });
        }
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

app.get('/colaboradores', async (req, res) => {
    const { busca, page = 1 } = req.query;
    const itemsPerPage = 20;
    const offset = (page - 1) * itemsPerPage;
    
    try {
        let whereClause = `WHERE c.status = 'ativo'`;
        const params = [];
        if (busca) {
            whereClause += ` AND (c.nome LIKE ? OR c.sobrenome LIKE ? OR c.cpf LIKE ?)`;
            params.push(`%${busca}%`, `%${busca}%`, `%${busca}%`);
        }

        const countQuery = `SELECT COUNT(*) as total FROM colaboradores c ${whereClause}`;
        const dataQuery = `
            SELECT c.colaborador_id, c.nome, c.sobrenome, c.cpf, crg.nome AS cargo_nome 
            FROM colaboradores c
            LEFT JOIN cargos crg ON c.cargo_id = crg.cargo_id
            ${whereClause}
            ORDER BY c.nome ASC
            LIMIT ? OFFSET ?
        `;
        
        const [totalResult] = await pool.query(countQuery, params);
        params.push(itemsPerPage, offset);
        const [dataResult] = await pool.query(dataQuery, params);
        
        const totalItems = totalResult[0].total;
        res.json({
            success: true,
            colaboradores: dataResult,
            pagination: {
                totalItems: totalItems,
                totalPages: Math.ceil(totalItems / itemsPerPage),
                currentPage: parseInt(page)
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

app.get('/clientes', async (req, res) => {
    const { busca, page = 1 } = req.query;
    const itemsPerPage = 20;
    const offset = (page - 1) * itemsPerPage;

    try {
        let whereClause = `WHERE status = 'ativo'`;
        const params = [];
        if (busca) {
            whereClause += ` AND (nome LIKE ? OR sobrenome LIKE ? OR cpf LIKE ?)`;
            params.push(`%${busca}%`, `%${busca}%`, `%${busca}%`);
        }

        const countQuery = `SELECT COUNT(*) as total FROM clientes ${whereClause}`;
        const dataQuery = `
            SELECT cliente_id, nome, sobrenome, email, cpf, telefone 
            FROM clientes
            ${whereClause}
            ORDER BY nome ASC
            LIMIT ? OFFSET ?
        `;
        
        const [totalResult] = await pool.query(countQuery, params);
        params.push(itemsPerPage, offset);
        const [dataResult] = await pool.query(dataQuery, params);
        
        const totalItems = totalResult[0].total;

        res.json({
            success: true,
            clientes: dataResult,
            pagination: {
                totalItems: totalItems,
                totalPages: Math.ceil(totalItems / itemsPerPage),
                currentPage: parseInt(page)
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

app.get('/cargos', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT cargo_id, nome, 
            acesso_cadastro_cliente, acesso_cadastro_colaborador, acesso_cadastro_servico, 
            ver_manutencao_cliente, editar_manutencao_cliente, 
            ver_manutencao_colaborador, editar_manutencao_colaborador, 
            ver_manutencao_servico, editar_manutencao_servico, 
            ver_manutencao_cargo, editar_manutencao_cargo 
            FROM cargos
        `);
        
        const cargosFormatados = rows.map(cargo => ({
            ...cargo,
            acesso_cadastro_cliente: cargo.acesso_cadastro_cliente[0] === 1,
            acesso_cadastro_colaborador: cargo.acesso_cadastro_colaborador[0] === 1,
            acesso_cadastro_servico: cargo.acesso_cadastro_servico[0] === 1,
            ver_manutencao_cliente: cargo.ver_manutencao_cliente[0] === 1,
            editar_manutencao_cliente: cargo.editar_manutencao_cliente[0] === 1,
            ver_manutencao_colaborador: cargo.ver_manutencao_colaborador[0] === 1,
            editar_manutencao_colaborador: cargo.editar_manutencao_colaborador[0] === 1,
            ver_manutencao_servico: cargo.ver_manutencao_servico[0] === 1,
            editar_manutencao_servico: cargo.editar_manutencao_servico[0] === 1,
            ver_manutencao_cargo: cargo.ver_manutencao_cargo[0] === 1,
            editar_manutencao_cargo: cargo.editar_manutencao_cargo[0] === 1
        }));
        
        res.json({ success: true, cargos: cargosFormatados });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

app.delete('/colaboradores/:cpf', async (req, res) => {
    const { cpf } = req.params;
    try {
        const [result] = await pool.query('DELETE FROM colaboradores WHERE cpf = ?', [cpf]);
        if (result.affectedRows > 0) {
            res.json({ success: true, message: 'Colaborador removido com sucesso.' });
        } else {
            res.status(404).json({ success: false, message: 'Colaborador não encontrado.' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro interno ao apagar colaborador.' });
    }
});

app.get('/colaboradores/:cpf', async (req, res) => {
    const { cpf } = req.params;
    try {
        const [rows] = await pool.query('SELECT nome, sobrenome, email, endereco, telefone, cpf, status, cargo_id FROM colaboradores WHERE cpf = ?', [cpf]);
        if (rows.length > 0) {
            res.json({ success: true, colaborador: rows[0] });
        } else {
            res.status(404).json({ success: false, message: 'Colaborador não encontrado.' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

app.get('/clientes/:cpf', async (req, res) => {
    const { cpf } = req.params;
    try {
        const [rows] = await pool.query('SELECT * FROM clientes WHERE cpf = ?', [cpf]);
        if (rows.length > 0) {
            res.json({ success: true, cliente: rows[0] });
        } else {
            res.status(404).json({ success: false, message: 'Cliente não encontrado.' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

app.put('/colaboradores/:cpf', async (req, res) => {
    const { cpf } = req.params;
    const { nome, sobrenome, email, senha, endereco, cargo_id, telefone, status } = req.body;

    if (!nome || !sobrenome || !email || !endereco || !cargo_id || !telefone || !status) {
        return res.status(400).json({ success: false, message: 'Campos obrigatórios não preenchidos.' });
    }

    try {
        let query = `UPDATE colaboradores SET nome = ?, sobrenome = ?, email = ?, endereco = ?, cargo_id = ?, telefone = ?, status = ?`;
        const params = [nome, sobrenome, email, endereco, cargo_id, telefone, status];
        
        if (senha) {
            const hashedPassword = await bcrypt.hash(senha, saltRounds);
            query += `, senha = ?`;
            params.push(hashedPassword);
        }
        query += ` WHERE cpf = ?`;
        params.push(cpf);

        const [result] = await pool.query(query, params);
        if (result.affectedRows > 0) {
            res.json({ success: true, message: 'Colaborador atualizado com sucesso!' });
        } else {
            res.status(404).json({ success: false, message: 'Colaborador não encontrado.' });
        }
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
             return res.status(409).json({ success: false, message: 'O e-mail informado já está em uso por outro colaborador.' });
        }
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

app.put('/clientes/:cpf', async (req, res) => {
    const { cpf } = req.params;
    const { nome, sobrenome, email, data_nascimento, endereco, telefone, status } = req.body;

    if (!nome || !sobrenome || !email || !data_nascimento) {
        return res.status(400).json({ success: false, message: 'Campos obrigatórios não preenchidos.' });
    }
    try {
        const params = [nome, sobrenome, email, data_nascimento, endereco, telefone, status, cpf];
        const query = `
            UPDATE clientes SET 
                nome = ?, sobrenome = ?, email = ?, data_nascimento = ?, 
                endereco = ?, telefone = ?, status = ?
            WHERE cpf = ?
        `;
        const [result] = await pool.query(query, params);

        if (result.affectedRows > 0) {
            res.json({ success: true, message: 'Cliente atualizado com sucesso!' });
        } else {
            res.status(404).json({ success: false, message: 'Cliente não encontrado.' });
        }
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
             return res.status(409).json({ success: false, message: 'O e-mail informado já está em uso por outro cliente.' });
        }
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

app.post('/cargos', async (req, res) => {
    const { nome, permissoes } = req.body;
    if (!nome || !permissoes) {
        return res.status(400).json({ success: false, message: 'Nome e permissões são obrigatórios.' });
    }
    try {
        const [checkResult] = await pool.query('SELECT COUNT(*) AS count FROM cargos WHERE nome = ?', [nome]);
        if (checkResult[0].count > 0) {
            return res.status(409).json({ success: false, message: 'Já existe um cargo com este nome.' });
        }

        const permissoesFormatadas = {};
        for (const key in permissoes) {
            permissoesFormatadas[key] = permissoes[key] ? 1 : 0;
        }

        const fields = ['nome', ...Object.keys(permissoesFormatadas)];
        const placeholders = fields.map(() => '?').join(', ');
        const values = [nome, ...Object.values(permissoesFormatadas)];
        
        await pool.query(`INSERT INTO cargos (${fields.join(', ')}) VALUES (${placeholders})`, values);
        res.status(201).json({ success: true, message: 'Cargo criado com sucesso!' });

    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

app.put('/cargos/:id', async (req, res) => {
    const { id } = req.params;
    const { nome, permissoes } = req.body;
    if (!nome || !permissoes) {
        return res.status(400).json({ success: false, message: 'Nome e permissões são obrigatórios.' });
    }
    try {
        const permissoesFormatadas = {};
        for (const key in permissoes) {
            permissoesFormatadas[key] = permissoes[key] ? 1 : 0;
        }

        const setClause = Object.keys(permissoesFormatadas).map(key => `${key} = ?`).join(', ');
        const values = [...Object.values(permissoesFormatadas), nome, id];
        const query = `UPDATE cargos SET ${setClause}, nome = ? WHERE cargo_id = ?`;
        
        const [result] = await pool.query(query, values);

        if (result.affectedRows > 0) {
            res.json({ success: true, message: 'Cargo atualizado com sucesso!' });
        } else {
            res.status(404).json({ success: false, message: 'Cargo não encontrado.' });
        }
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ success: false, message: 'Já existe outro cargo com este nome.' });
        }
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

async function gerarCodigoAcessoUnico() {
    let codigo;
    let codigoExiste = true;
    while (codigoExiste) {
        codigo = Math.random().toString(36).substring(2, 8).toUpperCase();
        const [result] = await pool.query('SELECT COUNT(*) as count FROM servicos WHERE codigo_acesso = ?', [codigo]);
        if (result[0].count === 0) {
            codigoExiste = false;
        }
    }
    return codigo;
}

app.post('/servicos', async (req, res) => {
    const { 
        cliente_id, colaborador_id, marca, modelo, imei, numero_serie, cor,
        esta_ligando, servico_solicitado, problema_relatado, checklist_entrada 
    } = req.body;
    
    if (!cliente_id || !colaborador_id || !marca || !modelo) {
        return res.status(400).json({ success: false, message: 'Campos obrigatórios não preenchidos.' });
    }
    try {
        const codigo_acesso = await gerarCodigoAcessoUnico();
        
        const params = [
            cliente_id, colaborador_id, codigo_acesso, marca, modelo, imei || null,
            numero_serie || null, cor, esta_ligando, servico_solicitado || '', problema_relatado || '', 
            'Aberto', checklist_entrada || null
        ];
        
        await pool.query(`
            INSERT INTO servicos (
                cliente_id, colaborador_id, codigo_acesso, marca, modelo, imei, 
                numero_serie, cor, esta_ligando, servico_solicitado, problema, status, 
                checklist_entrada
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, params);

        const [clienteResult] = await pool.query('SELECT nome, sobrenome, email FROM clientes WHERE cliente_id = ?', [cliente_id]);
        if (clienteResult.length > 0) {
            const cliente = clienteResult[0];
            enviarEmailAbertura(cliente.email, `${cliente.nome} ${cliente.sobrenome}`, codigo_acesso, modelo);
        }
        res.status(201).json({ success: true, message: 'Ordem de serviço cadastrada!', codigo_acesso: codigo_acesso });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

app.get('/servicos/:codigo', async (req, res) => {
    const { codigo } = req.params;
    try {
        const query = `
            SELECT 
                s.servico_id, s.modelo, s.problema, s.descricao, s.status, s.data_entrada,
                c.nome AS cliente_nome, c.sobrenome AS cliente_sobrenome
            FROM servicos s
            JOIN clientes c ON s.cliente_id = c.cliente_id
            WHERE s.codigo_acesso = ?
        `;
        const [rows] = await pool.query(query, [codigo.toUpperCase()]);

        if (rows.length > 0) {
            res.json({ success: true, servico: rows[0] });
        } else {
            res.status(404).json({ success: false, message: 'Nenhuma ordem de serviço encontrada.' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

app.get('/servicos', async (req, res) => {
    const { busca, status, page = 1 } = req.query;
    const itemsPerPage = 20;
    const offset = (page - 1) * itemsPerPage;

    try {
        const conditions = [];
        const params = [];
        if (busca) {
            conditions.push(`(c.nome LIKE ? OR c.sobrenome LIKE ? OR s.codigo_acesso LIKE ? OR s.modelo LIKE ?)`);
            const termo = `%${busca}%`;
            params.push(termo, termo, termo, termo);
        }
        if (status && status !== 'Todos') {
            conditions.push(`s.status = ?`);
            params.push(status);
        }
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const countQuery = `SELECT COUNT(*) as total FROM servicos s JOIN clientes c ON s.cliente_id = c.cliente_id ${whereClause}`;
        const dataQuery = `
            SELECT 
                s.servico_id, s.codigo_acesso, s.modelo, s.status,
                c.nome AS cliente_nome, c.sobrenome AS cliente_sobrenome
            FROM servicos s
            JOIN clientes c ON s.cliente_id = c.cliente_id
            ${whereClause}
            ORDER BY s.data_entrada DESC
            LIMIT ? OFFSET ?
        `;
        
        const [totalResult] = await pool.query(countQuery, params);
        params.push(itemsPerPage, offset);
        const [dataResult] = await pool.query(dataQuery, params);
        
        const totalItems = totalResult[0].total;
        res.json({ 
            success: true, 
            servicos: dataResult,
            pagination: {
                totalItems: totalItems,
                totalPages: Math.ceil(totalItems / itemsPerPage),
                currentPage: parseInt(page)
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

app.get('/servicos/editar/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const query = `
            SELECT 
                s.*,
                c.nome AS cliente_nome,
                c.sobrenome AS cliente_sobrenome
            FROM servicos s
            JOIN clientes c ON s.cliente_id = c.cliente_id
            WHERE s.servico_id = ?
        `;
        const [rows] = await pool.query(query, [id]);

        if (rows.length > 0) {
            res.json({ success: true, servico: rows[0] });
        } else {
            res.status(404).json({ success: false, message: 'Serviço não encontrado.' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

app.put('/servicos/:id', async (req, res) => {
    const { id } = req.params;
    const { status, diagnostico_tecnico, solucao_aplicada, valor_total, observacoes } = req.body;
    
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        try {
            const [servicoAtualResult] = await connection.query('SELECT status, cliente_id, modelo, codigo_acesso FROM servicos WHERE servico_id = ?', [id]);
            const servicoAtual = servicoAtualResult[0];

            let query = `
                UPDATE servicos SET 
                    status = ?, diagnostico_tecnico = ?, solucao_aplicada = ?,
                    valor_total = ?, observacoes = ?
            `;
            const params = [status, diagnostico_tecnico || '', solucao_aplicada || '', valor_total || null, observacoes || ''];
            
            if (status === 'Finalizado') {
                query += `, data_finalizacao = NOW()`;
            }
            query += ` WHERE servico_id = ?`;
            params.push(id);
            
            await connection.query(query, params);

            if (servicoAtual.status !== status) {
                const [clienteResult] = await connection.query('SELECT nome, sobrenome, email FROM clientes WHERE cliente_id = ?', [servicoAtual.cliente_id]);
                if (clienteResult.length > 0) {
                    const cliente = clienteResult[0];
                    enviarEmailStatus(cliente.email, `${cliente.nome} ${cliente.sobrenome}`, servicoAtual.codigo_acesso, servicoAtual.modelo, status);
                }
            }
            
            await connection.commit();
            res.json({ success: true, message: 'Serviço atualizado com sucesso!' });
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            if (connection) connection.release();
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

app.put('/colaboradores/:cpf', async (req, res) => {
    const { cpf } = req.params;
    const { nome, sobrenome, email, senha, endereco, cargo_id, telefone, status } = req.body;

    if (!nome || !sobrenome || !email || !endereco || !cargo_id || !telefone || !status) {
        return res.status(400).json({ success: false, message: 'Campos obrigatórios não preenchidos.' });
    }

    try {
        let query = `UPDATE colaboradores SET nome = ?, sobrenome = ?, email = ?, endereco = ?, cargo_id = ?, telefone = ?, status = ?`;
        const params = [nome, sobrenome, email, endereco, cargo_id, telefone, status];
        
        if (senha) {
            const hashedPassword = await bcrypt.hash(senha, saltRounds);
            query += `, senha = ?`;
            params.push(hashedPassword);
        }
        query += ` WHERE cpf = ?`;
        params.push(cpf);

        const [result] = await pool.query(query, params);
        if (result.affectedRows > 0) {
            res.json({ success: true, message: 'Colaborador atualizado com sucesso!' });
        } else {
            res.status(404).json({ success: false, message: 'Colaborador não encontrado.' });
        }
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
             return res.status(409).json({ success: false, message: 'O e-mail informado já está em uso por outro colaborador.' });
        }
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

async function startServer() {
    try {       
        pool = mysql.createPool(dbConfig);
        await pool.query('SELECT 1');
        console.log('Conectado ao MySQL!');

        app.listen(PORT, () => {
        });
    } catch (err) {
        console.error('Falha CRÍTICA ao conectar com o MySQL na inicialização:', err);
        process.exit(1);
    }
}

startServer();


