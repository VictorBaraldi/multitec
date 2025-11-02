const nodemailer = require('nodemailer')

const transport = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, 
    auth: {
        user: process.env.EMAIL_USER, 
        pass: process.env.EMAIL_PASS  
    }
});

/**
 * Envia um e-mail de notificação de serviço finalizado.
 * @param {string} destinatarioEmail 
 * @param {string} nomeCliente 
 * @param {string} codigoAcesso 
 * @param {string} modeloEquipamento 
 */
const enviarEmailAbertura = async (destinatarioEmail, nomeCliente, codigoAcesso, modeloEquipamento) => {
    console.log(`Preparando para enviar e-mail para ${destinatarioEmail}...`);

    try {
        const info = await transport.sendMail({
            from: 'Multitec Colina <ColinaMultitec@gmail.com>',
            to: destinatarioEmail,
            subject: 'Recebemos seu equipamento! Acompanhe o serviço online',
             html: `
                <h1>Olá, ${nomeCliente}!</h1>
                <p>Confirmamos o recebimento do seu equipamento <strong>${modeloEquipamento}</strong> em nossa assistência.</p>
                <p>Sua ordem de serviço foi criada com sucesso!</p>
                <p>Para acompanhar cada etapa do processo, de forma simples e transparente, utilize o código de acesso abaixo em nosso site.</p>
                <br>
                <h2>Seu código de acesso é: ${codigoAcesso}</h2>
                <br>
                <p>Manteremos você informado sobre qualquer atualização.</p>
                <p><strong>Equipe Multitec Colina</strong></p>
            `,
        });

        console.log(`E-mail enviado com sucesso! Message ID: ${info.messageId}`);
        return { success: true, messageId: info.messageId };

    } catch (error) {
        console.error("Erro ao enviar o e-mail:", error);
        return { success: false, error: error };
    }
};

const enviarEmailStatus = async (destinatarioEmail, nomeCliente, codigoAcesso, modeloEquipamento, novoStatus) => {
    
    const templates = {
        'Em analise': {
            subject: `Seu equipamento ${modeloEquipamento} está em análise`,
            html: `<h1>Olá, ${nomeCliente}!</h1><p>Informamos que seu equipamento <strong>${modeloEquipamento}</strong> já está na bancada e sendo analisado por nossos técnicos. Em breve, enviaremos novas atualizações.</p>`
        },
        'Aguardando autorizacao': {
            subject: `Orçamento para o seu ${modeloEquipamento} está pronto`,
            html: `<h1>Olá, ${nomeCliente}!</h1><p>O diagnóstico do seu equipamento <strong>${modeloEquipamento}</strong> foi concluído. O orçamento para o reparo já está disponível. Por favor, entre em contato para aprovar o serviço.</p>`
        },
        'Em andamento': {
            subject: `O reparo do seu ${modeloEquipamento} foi iniciado`,
            html: `<h1>Olá, ${nomeCliente}!</h1><p>Boas notícias! Já iniciamos o reparo no seu equipamento <strong>${modeloEquipamento}</strong>. Avisaremos assim que estiver pronto.</p>`
        },
        'Finalizado': {
            subject: `Seu equipamento ${modeloEquipamento} está pronto!`,
            html: `<h1>Olá, ${nomeCliente}!</h1><p>Ótima notícia! O serviço no seu equipamento <strong>${modeloEquipamento}</strong> foi concluído e ele já está disponível para retirada.</p>`
        }
    };

    const template = templates[novoStatus];
    if (!template) {
        console.log(`Nenhum template de e-mail para o status: ${novoStatus}`);
        return;
    }

    console.log(`Preparando e-mail de status '${novoStatus}' para ${destinatarioEmail}...`);
    try {
        await transport.sendMail({
            from: 'Multitec Colina <ColinaMultitec@gmail.com>',
            to: destinatarioEmail,
            subject: template.subject,
            html: `${template.html}<br><p>Utilize o código <strong>${codigoAcesso}</strong> para acompanhar os detalhes em nosso site.</p><p><strong>Equipe Multitec Colina</strong></p>`
        });
        console.log(`E-mail enviado com sucesso para ${destinatarioEmail}`);
    } catch (error) {
        console.error(`Falha ao enviar e-mail de status para ${destinatarioEmail}:`, error);
    }
};

module.exports = {
    enviarEmailAbertura,
    enviarEmailStatus
};