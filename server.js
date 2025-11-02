require('dotenv').config();
const bcrypt = require('bcrypt');
const saltRounds = 10;
const express = require('express');
const sql = require('mssql');
const cors = require('cors');
const { enviarEmailAbertura, enviarEmailStatus } = require('./email');
const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
const dbConfig = {
    user: 'sa',
    password: 'yQ0uNLEZgxqMSu',
    server: 'localhost', 
    database: 'SERVICELITE',
    options: {
        encrypt: false,
        trustServerCertificate: true,
        connectTimeout: 30000
    }
};

let pool; 



app.post('/login', async (req, res) => {
    const { email, senha } = req.body;
    if (!email || !senha) {
        return res.status(400).json({ success: false, message: 'E-mail e senha são obrigatórios.' });
    }
    try {
        if (!pool) {
            return res.status(500).json({ success: false, message: 'Erro de conexão.' });
        }
        const request = pool.request();
        const result = await request.input('emailParam', sql.VarChar, email)
            .query(`
                SELECT 
                    c.colaborador_id, c.nome, c.sobrenome, c.email, c.senha,
                    crg.nome AS cargo_nome, crg.acesso_cadastro_cliente, crg.acesso_cadastro_colaborador, 
                    crg.acesso_cadastro_servico, crg.ver_manutencao_cliente, crg.editar_manutencao_cliente,
                    crg.ver_manutencao_colaborador, crg.editar_manutencao_colaborador, crg.ver_manutencao_servico,
                    crg.editar_manutencao_servico, crg.ver_manutencao_cargo, crg.editar_manutencao_cargo
                FROM colaboradores c 
                INNER JOIN cargos crg ON c.cargo_id = crg.cargo_id 
                WHERE c.email = @emailParam AND c.status = 'ativo'
            `);

        if (result.recordset.length > 0) {
            const usuario = result.recordset[0];
            const senhaValida = await bcrypt.compare(senha, usuario.senha);

            if (senhaValida) {
                const permissoes = {
                    acesso_cadastro_cliente: usuario.acesso_cadastro_cliente,
                    acesso_cadastro_colaborador: usuario.acesso_cadastro_colaborador,
                    acesso_cadastro_servico: usuario.acesso_cadastro_servico,
                    ver_manutencao_cliente: usuario.ver_manutencao_cliente,
                    editar_manutencao_cliente: usuario.editar_manutencao_cliente,
                    ver_manutencao_colaborador: usuario.ver_manutencao_colaborador,
                    editar_manutencao_colaborador: usuario.editar_manutencao_colaborador,
                    ver_manutencao_servico: usuario.ver_manutencao_servico,
                    editar_manutencao_servico: usuario.editar_manutencao_servico,
                    ver_manutencao_cargo: usuario.ver_manutencao_cargo,
                    editar_manutencao_cargo: usuario.editar_manutencao_cargo
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
        if (!pool) {
            return res.status(500).json({ success: false, message: 'Erro de conexão com o banco.' });
        }

        const checkUsageRequest = pool.request();
        checkUsageRequest.input('cargoId', sql.Int, id);
        const usageResult = await checkUsageRequest.query('SELECT COUNT(*) as total FROM colaboradores WHERE cargo_id = @cargoId');
        
        if (usageResult.recordset[0].total > 0) {
            return res.status(409).json({ 
                success: false,
                message: 'Este cargo não pode ser apagado pois está sendo utilizado por um ou mais colaboradores.'
            });
        }

        const deleteRequest = pool.request();
        deleteRequest.input('id', sql.Int, id);
        const result = await deleteRequest.query('DELETE FROM cargos WHERE cargo_id = @id');

        if (result.rowsAffected[0] > 0) {
            res.json({ success: true, message: 'Cargo apagado com sucesso!' });
        } else {
            res.status(404).json({ success: false, message: 'Cargo não encontrado.' });
        }

    } catch (error) {
        console.error('Erro ao apagar cargo:', error.originalError || error);
        res.status(500).json({ success: false, message: 'Erro interno do servidor ao apagar cargo.' });
    }
});

app.post('/cadastrar_colaborador', async (req, res) => {
    const { nome, sobrenome, email, senha, endereco, cargo_id, telefone, cpf } = req.body;

    if (!nome || !sobrenome || !email || !senha || !endereco || !cargo_id || !telefone || !cpf) {
        return res.status(400).json({ success: false, message: 'Todos os campos são obrigatórios.' });
    }

    try {
        if (!pool) {
            return res.status(500).json({ success: false, message: 'Erro de conexão com o banco.' });
        }

        const hashedPassword = await bcrypt.hash(senha, saltRounds);

        const checkCpfRequest = pool.request();
        checkCpfRequest.input('cpfParam', sql.VarChar, cpf);
        const cpfResult = await checkCpfRequest.query(`SELECT * FROM colaboradores WHERE cpf = @cpfParam`);

        if (cpfResult.recordset.length > 0) {
            const existingCollaborator = cpfResult.recordset[0];

            if (existingCollaborator.status === 'ativo') {
                return res.status(409).json({ success: false, message: 'O CPF informado já está em uso por um colaborador ativo.' });
            }

            const checkEmailRequest = pool.request();
            checkEmailRequest.input('emailParam', sql.VarChar, email);
            checkEmailRequest.input('cpfParam', sql.VarChar, cpf); 
            const emailResult = await checkEmailRequest.query(`
                SELECT email FROM colaboradores WHERE email = @emailParam AND cpf != @cpfParam AND status = 'ativo'
            `);

            if (emailResult.recordset.length > 0) {
                return res.status(409).json({ success: false, message: 'O email informado já está em uso por outro colaborador ativo.' });
            }

            const updateRequest = pool.request();
            updateRequest.input('nome', sql.VarChar, nome);
            updateRequest.input('sobrenome', sql.VarChar, sobrenome);
            updateRequest.input('email', sql.VarChar, email);
            updateRequest.input('senha', sql.VarChar, hashedPassword);
            updateRequest.input('endereco', sql.VarChar, endereco);
            updateRequest.input('cargo_id', sql.Int, cargo_id);
            updateRequest.input('telefone', sql.VarChar, telefone);
            updateRequest.input('cpfToUpdate', sql.VarChar, cpf);

            await updateRequest.query(`
                UPDATE colaboradores 
                SET 
                    nome = @nome, 
                    sobrenome = @sobrenome, 
                    email = @email, 
                    senha = @senha, 
                    endereco = @endereco, 
                    cargo_id = @cargo_id, 
                    telefone = @telefone, 
                    status = 'ativo'
                WHERE cpf = @cpfToUpdate
            `);

            return res.status(200).json({ success: true, message: 'Colaborador inativo foi reativado e atualizado com sucesso!' });
        }

        const checkEmailRequest = pool.request();
        checkEmailRequest.input('emailParam', sql.VarChar, email);
        const emailResult = await checkEmailRequest.query(`
            SELECT email FROM colaboradores WHERE email = @emailParam AND status = 'ativo'
        `);

        if (emailResult.recordset.length > 0) {
            return res.status(409).json({ success: false, message: 'O email informado já está em uso por um colaborador ativo.' });
        }
        
        const insertRequest = pool.request();
        insertRequest.input('nome', sql.VarChar, nome);
        insertRequest.input('sobrenome', sql.VarChar, sobrenome);
        insertRequest.input('email', sql.VarChar, email);
        insertRequest.input('senha', sql.VarChar, hashedPassword);
        insertRequest.input('endereco', sql.VarChar, endereco);
        insertRequest.input('cargo_id', sql.Int, cargo_id);
        insertRequest.input('telefone', sql.VarChar, telefone);
        insertRequest.input('cpf', sql.VarChar, cpf);

        await insertRequest.query(`
            INSERT INTO colaboradores (nome, sobrenome, email, senha, endereco, cargo_id, telefone, cpf, status)
            VALUES (@nome, @sobrenome, @email, @senha, @endereco, @cargo_id, @telefone, @cpf, 'ativo')
        `);

        res.status(201).json({ success: true, message: 'Colaborador cadastrado com sucesso!' });

    } catch (error) {
        if (error.number === 2627 || error.number === 2601) {
            return res.status(409).json({ success: false, message: 'Erro de duplicidade. O CPF ou Email já pode estar em uso.' });
        }
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

app.post('/cadastrar_cliente', async (req, res) => {
    const { nome, sobrenome, email, data_nascimento, endereco, telefone, cpf } = req.body;
    if (!nome || !sobrenome || !email || !data_nascimento || !cpf) {
        return res.status(400).json({ success: false, message: 'Nome, sobrenome, email, data de nascimento e CPF são obrigatórios.' });
    }

    try {
        if (!pool) {
            return res.status(500).json({ success: false, message: 'Erro de conexão com o banco.' });
        }
        const checkCpfRequest = pool.request();
        checkCpfRequest.input('cpfParam', sql.Char(14), cpf);
        const cpfResult = await checkCpfRequest.query('SELECT * FROM clientes WHERE cpf = @cpfParam');
        if (cpfResult.recordset.length > 0) {
            const existingClient = cpfResult.recordset[0];

            if (existingClient.status === 'ativo') {
                return res.status(409).json({ success: false, message: 'Erro: O CPF informado já está em uso por um cliente ativo.' });
            }
            const checkEmailRequest = pool.request();
            checkEmailRequest.input('emailParam', sql.NVarChar(100), email);
            checkEmailRequest.input('cpfParam', sql.Char(14), cpf);
            const emailResult = await checkEmailRequest.query(`
                SELECT email FROM clientes WHERE email = @emailParam AND cpf != @cpfParam AND status = 'ativo'
            `);

            if (emailResult.recordset.length > 0) {
                return res.status(409).json({ success: false, message: 'Erro: O e-mail informado já está em uso por outro cliente ativo.' });
            }

            const updateRequest = pool.request();
            updateRequest.input('nome', sql.NVarChar(100), nome);
            updateRequest.input('sobrenome', sql.NVarChar(100), sobrenome);
            updateRequest.input('email', sql.NVarChar(100), email);
            updateRequest.input('data_nascimento', sql.Date, data_nascimento);
            updateRequest.input('endereco', sql.NVarChar(255), endereco);
            updateRequest.input('telefone', sql.NVarChar(20), telefone);
            updateRequest.input('cpfToUpdate', sql.Char(14), cpf);

            await updateRequest.query(`
                UPDATE clientes SET
                    nome = @nome,
                    sobrenome = @sobrenome,
                    email = @email,
                    data_nascimento = @data_nascimento,
                    endereco = @endereco,
                    telefone = @telefone,
                    status = 'ativo'
                WHERE cpf = @cpfToUpdate
            `);

            return res.status(200).json({ success: true, message: 'Cliente inativo foi reativado e atualizado com sucesso!' });

        } else {
            const checkEmailRequest = pool.request();
            checkEmailRequest.input('emailParam', sql.NVarChar(100), email);
            const emailResult = await checkEmailRequest.query(`
                SELECT email FROM clientes WHERE email = @emailParam AND status = 'ativo'
            `);

            if (emailResult.recordset.length > 0) {
                return res.status(409).json({ success: false, message: 'Erro: O e-mail informado já está em uso por um cliente ativo.' });
            }

            const insertRequest = pool.request();
            insertRequest.input('nome', sql.NVarChar(100), nome);
            insertRequest.input('sobrenome', sql.NVarChar(100), sobrenome);
            insertRequest.input('email', sql.NVarChar(100), email);
            insertRequest.input('data_nascimento', sql.Date, data_nascimento);
            insertRequest.input('endereco', sql.NVarChar(255), endereco);
            insertRequest.input('telefone', sql.NVarChar(20), telefone);
            insertRequest.input('cpf', sql.Char(14), cpf);

            await insertRequest.query(`
                INSERT INTO clientes (nome, sobrenome, email, data_nascimento, endereco, telefone, cpf, status)
                VALUES (@nome, @sobrenome, @email, @data_nascimento, @endereco, @telefone, @cpf, 'ativo')
            `);

            res.status(201).json({ success: true, message: 'Cliente cadastrado com sucesso!' });
        }

    } catch (error) {
        console.error('Erro detalhado ao cadastrar cliente:', error);
        if (error.number === 2627 || error.number === 2601) {
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
        if (!pool) {
            return res.status(500).json({ success: false, message: 'Erro de conexão.' });
        }

        let whereClause = `WHERE c.status = 'ativo'`;
        if (busca) {
            whereClause += ` AND (c.nome LIKE @termo OR c.sobrenome LIKE @termo OR c.cpf LIKE @termo)`;
        }

        const countQuery = `SELECT COUNT(*) as total FROM colaboradores c ${whereClause}`;
        const dataQuery = `
            SELECT c.colaborador_id, c.nome, c.sobrenome, c.cpf, crg.nome AS cargo_nome 
            FROM colaboradores c
            LEFT JOIN cargos crg ON c.cargo_id = crg.cargo_id
            ${whereClause}
            ORDER BY c.nome ASC
            OFFSET ${offset} ROWS FETCH NEXT ${itemsPerPage} ROWS ONLY
        `;
        
        const request = pool.request();
        if (busca) request.input('termo', sql.VarChar, `%${busca}%`);
        
        const countRequest = pool.request();
        if (busca) countRequest.input('termo', sql.VarChar, `%${busca}%`);

        const totalResult = await countRequest.query(countQuery);
        const dataResult = await request.query(dataQuery);
        
        const totalItems = totalResult.recordset[0].total;

        res.json({
            success: true,
            colaboradores: dataResult.recordset,
            pagination: {
                totalItems: totalItems,
                totalPages: Math.ceil(totalItems / itemsPerPage),
                currentPage: parseInt(page)
            }
        });

    } catch (error) {
        console.error('Erro ao buscar colaboradores:', error.originalError || error);
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});
app.get('/clientes', async (req, res) => {
    const { busca, page = 1 } = req.query;
    const itemsPerPage = 20;
    const offset = (page - 1) * itemsPerPage;

    try {
        if (!pool) {
            return res.status(500).json({ success: false, message: 'Erro de conexão.' });
        }

        let whereClause = `WHERE status = 'ativo'`;
        if (busca) {
            whereClause += ` AND (nome LIKE @termo OR sobrenome LIKE @termo OR cpf LIKE @termo)`;
        }

        const countQuery = `SELECT COUNT(*) as total FROM clientes ${whereClause}`;
        const dataQuery = `
            SELECT cliente_id, nome, sobrenome, email, cpf, telefone 
            FROM clientes
            ${whereClause}
            ORDER BY nome ASC
            OFFSET ${offset} ROWS FETCH NEXT ${itemsPerPage} ROWS ONLY
        `;
        
        const request = pool.request();
        if (busca) request.input('termo', sql.NVarChar, `%${busca}%`);
        
        const countRequest = pool.request();
        if (busca) countRequest.input('termo', sql.NVarChar, `%${busca}%`);

        const totalResult = await countRequest.query(countQuery);
        const dataResult = await request.query(dataQuery);
        
        const totalItems = totalResult.recordset[0].total;

        res.json({
            success: true,
            clientes: dataResult.recordset,
            pagination: {
                totalItems: totalItems,
                totalPages: Math.ceil(totalItems / itemsPerPage),
                currentPage: parseInt(page)
            }
        });

    } catch (error) {
        console.error('Erro ao buscar clientes:', error.originalError || error);
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});
app.get('/cargos', async (req, res) => {
    try {
        if (!pool) {
            console.error('Erro ao Buscar Cargos: Pool de conexões não inicializada.');
            return res.status(500).json({ success: false, message: 'Erro de conexão com o banco (pool não disponível).' });
        }
        const request = pool.request();
        const result = await request.query`SELECT 
                                                cargo_id, nome, 
                                                acesso_cadastro_cliente, 
                                                acesso_cadastro_colaborador, 
                                                acesso_cadastro_servico, 
                                                ver_manutencao_cliente, 
                                                editar_manutencao_cliente, 
                                                ver_manutencao_colaborador, 
                                                editar_manutencao_colaborador, 
                                                ver_manutencao_servico, 
                                                editar_manutencao_servico, 
                                                ver_manutencao_cargo, 
                                                editar_manutencao_cargo 
                                              FROM Cargos`;
        res.json({ success: true, cargos: result.recordset });
    } catch (error) {
        console.error('Erro ao buscar cargos:', error.originalError || error);
        res.status(500).json({ success: false, message: 'Erro interno do servidor ao buscar cargos.' });
    }
});

app.delete('/colaboradores/:cpf', async (req, res) => {
    const { cpf } = req.params;
    try {
        if (!pool) {
            console.error('Erro ao Deletar Colaborador: Pool de conexões não inicializada.');
            return res.status(500).json({ success: false, message: 'Erro de conexão com o banco (pool não disponível).' });
        }
        const request = pool.request();
        request.input('cpfParam', sql.VarChar, cpf);
        const result = await request.query`DELETE FROM colaboradores WHERE cpf = @cpfParam`;

        if (result.rowsAffected[0] > 0) {
            res.json({ success: true, message: 'Colaborador removido com sucesso.' });
        } else {
            res.status(404).json({ success: false, message: 'Colaborador não encontrado.' });
        }
    } catch (error) {
        console.error('Erro ao apagar colaborador:', error.originalError || error);
        res.status(500).json({ success: false, message: 'Erro interno ao apagar colaborador.' });
    }
});

app.get('/colaboradores/:cpf', async (req, res) => {
    const { cpf } = req.params;

    try {
        if (!pool) {
            return res.status(500).json({ success: false, message: 'Erro de conexão com o banco.' });
        }
        const request = pool.request();
        
        const result = await request
            .input('cpfParam', sql.VarChar, cpf)
            .query(`
                SELECT c.nome, c.sobrenome, c.email, c.endereco, c.telefone, c.cpf, c.status, c.cargo_id
                FROM colaboradores c
                WHERE c.cpf = @cpfParam
            `);

        if (result.recordset.length > 0) {
            res.json({ success: true, colaborador: result.recordset[0] });
        } else {
            res.status(404).json({ success: false, message: 'Colaborador não encontrado.' });
        }
    } catch (error) {
        console.error('Erro ao buscar colaborador por CPF:', error.originalError || error);
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

app.get('/clientes/:cpf', async (req, res) => {
    const { cpf } = req.params;

    try {
        if (!pool) {
            return res.status(500).json({ success: false, message: 'Erro de conexão com o banco.' });
        }
        const request = pool.request();
        
        const result = await request
            .input('cpfParam', sql.Char(14), cpf)
            .query('SELECT * FROM clientes WHERE cpf = @cpfParam');

        if (result.recordset.length > 0) {
            res.json({ success: true, cliente: result.recordset[0] });
        } else {
            res.status(404).json({ success: false, message: 'Cliente não encontrado.' });
        }
    } catch (error) {
        console.error('Erro ao buscar cliente por CPF:', error.originalError || error);
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});


app.put('/colaboradores/:cpf', async (req, res) => {
    const { cpf } = req.params;
    const { nome, sobrenome, email, senha, endereco, cargo_id, telefone, status } = req.body;

    if (!nome || !sobrenome || !email || !endereco || !cargo_id || !telefone || !status) {
        return res.status(400).json({ success: false, message: 'Todos os campos, exceto a senha, são obrigatórios.' });
    }

    try {
        if (!pool) {
            return res.status(500).json({ success: false, message: 'Erro de conexão com o banco.' });
        }
        const request = pool.request();

        let query = `
            UPDATE colaboradores SET 
                nome = @nome, 
                sobrenome = @sobrenome, 
                email = @email, 
                endereco = @endereco, 
                cargo_id = @cargo_id, 
                telefone = @telefone, 
                status = @status
        `;
        
        if (senha) {
            query += `, senha = @senha`;
            request.input('senha', sql.VarChar, senha);
        }

        query += ` WHERE cpf = @cpf`;

        request.input('nome', sql.VarChar, nome);
        request.input('sobrenome', sql.VarChar, sobrenome);
        request.input('email', sql.VarChar, email);
        request.input('endereco', sql.VarChar, endereco);
        request.input('cargo_id', sql.Int, cargo_id);
        request.input('telefone', sql.VarChar, telefone);
        request.input('status', sql.VarChar, status);
        request.input('cpf', sql.VarChar, cpf);

        const result = await request.query(query);

        if (result.rowsAffected[0] > 0) {
            res.json({ success: true, message: 'Colaborador atualizado com sucesso!' });
        } else {
            res.status(404).json({ success: false, message: 'Colaborador não encontrado para atualização.' });
        }

    } catch (error) {
        console.error('Erro ao atualizar colaborador:', error.originalError || error);
        if (error.number === 2627 || error.number === 2601) {
             return res.status(409).json({ success: false, message: 'O e-mail informado já está em uso por outro colaborador.' });
        }
        res.status(500).json({ success: false, message: 'Erro interno do servidor ao tentar atualizar.' });
    }
});

app.put('/clientes/:cpf', async (req, res) => {
    const { cpf } = req.params;
    const { nome, sobrenome, email, data_nascimento, endereco, telefone, status } = req.body;

    if (!nome || !sobrenome || !email || !data_nascimento) {
        return res.status(400).json({ success: false, message: 'Campos obrigatórios não preenchidos.' });
    }

    try {
        if (!pool) {
            return res.status(500).json({ success: false, message: 'Erro de conexão com o banco.' });
        }
        const request = pool.request();

        request.input('nome', sql.NVarChar(100), nome);
        request.input('sobrenome', sql.NVarChar(100), sobrenome);
        request.input('email', sql.NVarChar(100), email);
        request.input('data_nascimento', sql.Date, data_nascimento);
        request.input('endereco', sql.NVarChar(255), endereco);
        request.input('telefone', sql.NVarChar(20), telefone);
        request.input('status', sql.VarChar, status);
        request.input('cpf', sql.Char(14), cpf);

        const query = `
            UPDATE clientes SET 
                nome = @nome, 
                sobrenome = @sobrenome, 
                email = @email, 
                data_nascimento = @data_nascimento, 
                endereco = @endereco, 
                telefone = @telefone,
                status = @status
            WHERE cpf = @cpf
        `;

        const result = await request.query(query);

        if (result.rowsAffected[0] > 0) {
            res.json({ success: true, message: 'Cliente atualizado com sucesso!' });
        } else {
            res.status(404).json({ success: false, message: 'Cliente não encontrado para atualização.' });
        }

    } catch (error) {
        console.error('Erro ao atualizar cliente:', error.originalError || error);
        if (error.number === 2627 || error.number === 2601) {
             return res.status(409).json({ success: false, message: 'O e-mail informado já está em uso por outro cliente.' });
        }
        res.status(500).json({ success: false, message: 'Erro interno do servidor ao tentar atualizar cliente.' });
    }
});


app.post('/cargos', async (req, res) => {
    const { nome, permissoes } = req.body;

    if (!nome || !permissoes) {
        return res.status(400).json({ success: false, message: 'O nome do cargo e as permissões são obrigatórios.' });
    }

    try {
        if (!pool) {
            return res.status(500).json({ success: false, message: 'Erro de conexão com o banco.' });
        }
        const request = pool.request();

        const checkQuery = 'SELECT COUNT(*) AS count FROM cargos WHERE nome = @nome';
        request.input('nome', sql.VarChar, nome);
        const result = await request.query(checkQuery);
        
        if (result.recordset[0].count > 0) {
            return res.status(409).json({ success: false, message: 'Já existe um cargo com este nome.' });
        }

        for (const key in permissoes) {
            request.input(key, sql.Bit, permissoes[key]);
        }

        const insertQuery = `
            INSERT INTO cargos (
                nome, acesso_cadastro_cliente, acesso_cadastro_colaborador, acesso_cadastro_servico,
                ver_manutencao_cliente, editar_manutencao_cliente, ver_manutencao_colaborador,
                editar_manutencao_colaborador, ver_manutencao_servico, editar_manutencao_servico,
                ver_manutencao_cargo, editar_manutencao_cargo
            ) VALUES (
                @nome, @acesso_cadastro_cliente, @acesso_cadastro_colaborador, @acesso_cadastro_servico,
                @ver_manutencao_cliente, @editar_manutencao_cliente, @ver_manutencao_colaborador,
                @editar_manutencao_colaborador, @ver_manutencao_servico, @editar_manutencao_servico,
                @ver_manutencao_cargo, @editar_manutencao_cargo
            )
        `;

        await request.query(insertQuery);
        res.status(201).json({ success: true, message: 'Cargo criado com sucesso!' });

    } catch (error) {
        console.error('Erro ao criar cargo:', error.originalError || error);
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

app.put('/cargos/:id', async (req, res) => {
    const { id } = req.params;
    const { nome, permissoes } = req.body;

    if (!nome || !permissoes) {
        return res.status(400).json({ success: false, message: 'O nome do cargo e as permissões são obrigatórios.' });
    }

    try {
        if (!pool) {
            return res.status(500).json({ success: false, message: 'Erro de conexão com o banco.' });
        }
        const request = pool.request();

        request.input('id', sql.Int, id);
        request.input('nome', sql.VarChar, nome);
        for (const key in permissoes) {
            request.input(key, sql.Bit, permissoes[key]);
        }

        const query = `
            UPDATE cargos SET
                nome = @nome,
                acesso_cadastro_cliente = @acesso_cadastro_cliente,
                acesso_cadastro_colaborador = @acesso_cadastro_colaborador,
                acesso_cadastro_servico = @acesso_cadastro_servico,
                ver_manutencao_cliente = @ver_manutencao_cliente,
                editar_manutencao_cliente = @editar_manutencao_cliente,
                ver_manutencao_colaborador = @ver_manutencao_colaborador,
                editar_manutencao_colaborador = @editar_manutencao_colaborador,
                ver_manutencao_servico = @ver_manutencao_servico,
                editar_manutencao_servico = @editar_manutencao_servico,
                ver_manutencao_cargo = @ver_manutencao_cargo,
                editar_manutencao_cargo = @editar_manutencao_cargo
            WHERE cargo_id = @id
        `;

        const result = await request.query(query);

        if (result.rowsAffected[0] > 0) {
            res.json({ success: true, message: 'Cargo atualizado com sucesso!' });
        } else {
            res.status(404).json({ success: false, message: 'Cargo não encontrado.' });
        }

    } catch (error) {
        console.error('Erro ao atualizar cargo:', error.originalError || error);
         if (error.number === 2627) {
            return res.status(409).json({ success: false, message: 'Já existe outro cargo com este nome.' });
        }
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

async function startServer() {
    try {        
        pool = await sql.connect(dbConfig);
        console.log('Conectado!');

        pool.on('error', err => {
            console.error('Erro na conexão SQL (evento "error"):', err.originalError || err);
        });

        app.listen(PORT, () => {
            
        });
    } catch (err) {
        console.error('Falha CRÍTICA ao conectar com o SQL Server na inicialização:', err.originalError || err);
        console.error('Detalhes completos do erro de conexão:', err);
        process.exit(1);
    }
}

async function gerarCodigoAcessoUnico() {
    let codigo;
    let codigoExiste = true;
    
    while (codigoExiste) {
        codigo = Math.random().toString(36).substring(2, 8).toUpperCase();
        const request = pool.request();
        const result = await request
            .input('codigo', sql.VarChar, codigo)
            .query('SELECT COUNT(*) as count FROM servicos WHERE codigo_acesso = @codigo');
        
        if (result.recordset[0].count === 0) {
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
        return res.status(400).json({ 
            success: false, 
            message: 'Cliente, técnico, marca e modelo são obrigatórios.' 
        });
    }

    try {
        if (!pool) {
            return res.status(500).json({ success: false, message: 'Erro de conexão.' });
        }

        const codigo_acesso = await gerarCodigoAcessoUnico();
        
        const request = pool.request();
        request.input('cliente_id', sql.Int, cliente_id);
        request.input('colaborador_id', sql.Int, colaborador_id);
        request.input('codigo_acesso', sql.VarChar, codigo_acesso);
        request.input('marca', sql.VarChar, marca);
        request.input('modelo', sql.VarChar, modelo);
        request.input('imei', sql.VarChar, imei || null);
        request.input('numero_serie', sql.VarChar, numero_serie || null);
        request.input('cor', sql.VarChar, cor);
        request.input('esta_ligando', sql.VarChar, esta_ligando);
        request.input('servico_solicitado', sql.Text, servico_solicitado || '');
        request.input('problema', sql.Text, problema_relatado || '');
        request.input('checklist_entrada', sql.Text, checklist_entrada || null);

        await request.query(`
            INSERT INTO servicos (
                cliente_id, colaborador_id, codigo_acesso, marca, modelo, imei, 
                numero_serie, cor, esta_ligando, servico_solicitado, problema, status, 
                checklist_entrada
            ) VALUES (
                @cliente_id, @colaborador_id, @codigo_acesso, @marca, @modelo, @imei,
                @numero_serie, @cor, @esta_ligando, @servico_solicitado, @problema, 'Aberto',
                @checklist_entrada
            )
        `);

        const clienteRequest = pool.request();
        clienteRequest.input('clienteId', sql.Int, cliente_id);
        const clienteResult = await clienteRequest.query(
            'SELECT nome, sobrenome, email FROM clientes WHERE cliente_id = @clienteId'
        );

        if (clienteResult.recordset.length > 0) {
            const cliente = clienteResult.recordset[0];
            const nomeCompleto = `${cliente.nome} ${cliente.sobrenome}`;
            enviarEmailAbertura(cliente.email, nomeCompleto, codigo_acesso, modelo);
        }

        res.status(201).json({ 
            success: true, 
            message: 'Ordem de serviço cadastrada com sucesso!',
            codigo_acesso: codigo_acesso
        });

    } catch (error) {
        console.error('Erro ao cadastrar serviço:', error.originalError || error);
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});


app.get('/servicos/:codigo', async (req, res) => {
    const { codigo } = req.params;

    if (!codigo) {
        return res.status(400).json({ success: false, message: 'O código de acesso é obrigatório.' });
    }

    try {
        if (!pool) {
            return res.status(500).json({ success: false, message: 'Erro de conexão com o banco.' });
        }
        const request = pool.request();
        
        const result = await request
            .input('codigoParam', sql.VarChar, codigo.toUpperCase())
            .query(`
                SELECT 
                    s.servico_id, s.modelo, s.problema, s.descricao, s.status,
                    s.data_entrada,
                    c.nome AS cliente_nome, c.sobrenome AS cliente_sobrenome
                FROM servicos s
                JOIN clientes c ON s.cliente_id = c.cliente_id
                WHERE s.codigo_acesso = @codigoParam
            `);

        if (result.recordset.length > 0) {
            res.json({ success: true, servico: result.recordset[0] });
        } else {
            res.status(200).json({ success: false, message: 'Nenhuma ordem de serviço encontrada com este código.' });
        }
    } catch (error) {
        console.error('Erro ao buscar serviço por código:', error.originalError || error);
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

app.get('/servicos', async (req, res) => {
    const { busca, status, page = 1 } = req.query;
    const itemsPerPage = 20;
    const offset = (page - 1) * itemsPerPage;

    try {
        if (!pool) {
            return res.status(500).json({ success: false, message: 'Erro de conexão com o banco.' });
        }
        
        const conditions = [];
        let whereClause = '';
        if (busca) {
            conditions.push(`(c.nome LIKE @termo OR c.sobrenome LIKE @termo OR s.codigo_acesso LIKE @termo OR s.modelo LIKE @termo)`);
        }
        if (status && status !== 'Todos') {
            conditions.push(`s.status = @status`);
        }
        if (conditions.length > 0) {
            whereClause = `WHERE ${conditions.join(' AND ')}`;
        }

        const countQuery = `SELECT COUNT(*) as total FROM servicos s JOIN clientes c ON s.cliente_id = c.cliente_id ${whereClause}`;
        const dataQuery = `
            SELECT 
                s.servico_id, s.codigo_acesso, s.modelo, s.status,
                c.nome AS cliente_nome, c.sobrenome AS cliente_sobrenome
            FROM servicos s
            JOIN clientes c ON s.cliente_id = c.cliente_id
            ${whereClause}
            ORDER BY s.data_entrada DESC
            OFFSET ${offset} ROWS FETCH NEXT ${itemsPerPage} ROWS ONLY
        `;

        const request = pool.request();
        if (busca) request.input('termo', sql.VarChar, `%${busca}%`);
        if (status && status !== 'Todos') request.input('status', sql.VarChar, status);

        const [totalResult, dataResult] = await Promise.all([
            pool.request().query(countQuery.replace('@termo', `'\%${busca}\%'`).replace('@status', `'${status}'`)),
            request.query(dataQuery)
        ]);

        const totalItems = totalResult.recordset[0].total;

        res.json({ 
            success: true, 
            servicos: dataResult.recordset,
            pagination: {
                totalItems: totalItems,
                totalPages: Math.ceil(totalItems / itemsPerPage),
                currentPage: parseInt(page)
            }
        });

    } catch (error) {
        console.error('Erro ao buscar serviços:', error.originalError || error);
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

app.get('/servicos/editar/:id', async (req, res) => {
    const { id } = req.params;
    try {
        if (!pool) return res.status(500).json({ success: false, message: 'Erro de conexão.' });
        const request = pool.request();
        request.input('id', sql.Int, id);
        
        const result = await request.query(`
            SELECT 
                s.*,
                c.nome AS cliente_nome,
                c.sobrenome AS cliente_sobrenome
            FROM servicos s
            JOIN clientes c ON s.cliente_id = c.cliente_id
            WHERE s.servico_id = @id
        `);

        if (result.recordset.length > 0) {
            res.json({ success: true, servico: result.recordset[0] });
        } else {
            res.status(404).json({ success: false, message: 'Serviço não encontrado.' });
        }
    } catch (error) {
        console.error('Erro ao buscar serviço para edição:', error.originalError || error);
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

app.put('/servicos/:id', async (req, res) => {
    const { id } = req.params;
    const { status, diagnostico_tecnico, solucao_aplicada, valor_total, observacoes } = req.body;

    try {
        if (!pool) return res.status(500).json({ success: false, message: 'Erro de conexão.' });

        const transaction = pool.transaction();
        await transaction.begin();

        try {
            const servicoAtualRequest = new sql.Request(transaction);
            servicoAtualRequest.input('id', sql.Int, id);
            const servicoAtualResult = await servicoAtualRequest.query('SELECT status, cliente_id, modelo, codigo_acesso FROM servicos WHERE servico_id = @id');
            const servicoAtual = servicoAtualResult.recordset[0];

            const updateRequest = new sql.Request(transaction);
            updateRequest.input('id', sql.Int, id);
            updateRequest.input('status', sql.VarChar, status);
            updateRequest.input('diagnostico_tecnico', sql.Text, diagnostico_tecnico || '');
            updateRequest.input('solucao_aplicada', sql.Text, solucao_aplicada || '');
            updateRequest.input('valor_total', sql.Decimal(10, 2), valor_total || null);
            updateRequest.input('observacoes', sql.Text, observacoes || '');

            let query = `
                UPDATE servicos SET 
                    status = @status, 
                    diagnostico_tecnico = @diagnostico_tecnico,
                    solucao_aplicada = @solucao_aplicada,
                    valor_total = @valor_total,
                    observacoes = @observacoes
            `;
            if (status === 'Finalizado') {
                query += `, data_finalizacao = GETDATE()`;
            }
            query += ` WHERE servico_id = @id`;
            
            await updateRequest.query(query);

            if (servicoAtual.status !== status) {
                const clienteRequest = new sql.Request(transaction);
                clienteRequest.input('clienteId', sql.Int, servicoAtual.cliente_id);
                const clienteResult = await clienteRequest.query('SELECT nome, sobrenome, email FROM clientes WHERE cliente_id = @clienteId');
                
                if (clienteResult.recordset.length > 0) {
                    const cliente = clienteResult.recordset[0];
                    const nomeCompleto = `${cliente.nome} ${cliente.sobrenome}`;
                    enviarEmailStatus(cliente.email, nomeCompleto, servicoAtual.codigo_acesso, servicoAtual.modelo, status);
                }
            }

            await transaction.commit();
            res.json({ success: true, message: 'Serviço atualizado com sucesso!' });

        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (error) {
        console.error('Erro ao atualizar serviço:', error.originalError || error);
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});


startServer();
