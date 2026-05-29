const express = require("express");
const http = require("http");
const fs = require("fs");
const QRCode = require("qrcode");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const ARQUIVO_DADOS = "dados.json";

let aulas = {};
let contadorId = 1;

let ultimoEnvioPorAluno = {};
const TEMPO_ESPERA = 30 * 1000;

function carregarDados() {
  try {
    if (fs.existsSync(ARQUIVO_DADOS)) {
      const conteudo = fs.readFileSync(ARQUIVO_DADOS, "utf8");

      if (conteudo.trim() !== "") {
        const dados = JSON.parse(conteudo);
        aulas = dados.aulas || {};
        contadorId = dados.contadorId || 1;
      }
    }
  } catch (erro) {
    console.log("Erro ao carregar dados:", erro.message);
    aulas = {};
    contadorId = 1;
  }
}

function salvarDados() {
  const dados = {
    aulas: aulas,
    contadorId: contadorId
  };

  fs.writeFileSync(ARQUIVO_DADOS, JSON.stringify(dados, null, 2));
}

function gerarCodigo(materia) {
  let base = materia || "AULA";

  base = base
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z]/g, "")
    .substring(0, 3)
    .toUpperCase();

  if (base.length < 3) {
    base = "AUL";
  }

  let codigo;

  do {
    const numero = Math.floor(100 + Math.random() * 900);
    codigo = `${base}-${numero}`;
  } while (aulas[codigo]);

  return codigo;
}

// Gera imagem de QR Code
app.get("/qrcode", async (req, res) => {
  const texto = req.query.texto;

  if (!texto) {
    return res.status(400).send("Texto não informado.");
  }

  try {
    const imagem = await QRCode.toBuffer(texto, {
      type: "png",
      width: 260,
      margin: 2
    });

    res.setHeader("Content-Type", "image/png");
    res.send(imagem);
  } catch (erro) {
    res.status(500).send("Erro ao gerar QR Code.");
  }
});

carregarDados();

io.on("connection", (socket) => {
  console.log("Alguém conectou:", socket.id);

  socket.on("criarAula", (dados) => {
    const professor = dados.professor && dados.professor.trim() !== ""
      ? dados.professor.trim()
      : "";

    const materia = dados.materia && dados.materia.trim() !== ""
      ? dados.materia.trim()
      : "";

    const turma = dados.turma && dados.turma.trim() !== ""
      ? dados.turma.trim()
      : "";

    const senha = dados.senha && dados.senha.trim() !== ""
      ? dados.senha.trim()
      : "";

    if (professor === "") {
      socket.emit("erroProfessor", {
        mensagem: "Digite o nome do professor."
      });
      return;
    }

    if (materia === "") {
      socket.emit("erroProfessor", {
        mensagem: "Digite o nome da matéria ou aula."
      });
      return;
    }

    if (turma === "") {
      socket.emit("erroProfessor", {
        mensagem: "Digite a turma ou curso."
      });
      return;
    }

    if (senha === "") {
      socket.emit("erroProfessor", {
        mensagem: "Digite uma senha para o professor."
      });
      return;
    }

    const codigo = gerarCodigo(materia);

    aulas[codigo] = {
      codigo: codigo,
      professor: professor,
      materia: materia,
      turma: turma,
      senha: senha,
      perguntas: []
    };

    salvarDados();

    socket.join("aula-" + codigo);

    socket.emit("aulaCriada", {
      codigo: codigo,
      professor: professor,
      materia: materia,
      turma: turma
    });

    socket.emit("listaPerguntas", aulas[codigo].perguntas);
  });

  socket.on("entrarPainelProfessor", (dados) => {
    const codigo = dados.codigo.trim().toUpperCase();
    const senha = dados.senha.trim();

    if (!aulas[codigo]) {
      socket.emit("erroProfessor", {
        mensagem: "Código não encontrado. Verifique se a aula foi criada corretamente."
      });
      return;
    }

    if (aulas[codigo].senha !== senha) {
      socket.emit("erroProfessor", {
        mensagem: "Senha incorreta para este painel."
      });
      return;
    }

    socket.join("aula-" + codigo);

    socket.emit("aulaCriada", {
      codigo: codigo,
      professor: aulas[codigo].professor || "Não informado",
      materia: aulas[codigo].materia || "Não informada",
      turma: aulas[codigo].turma || "Não informada"
    });

    socket.emit("listaPerguntas", aulas[codigo].perguntas);
  });

  socket.on("novaPergunta", (dados) => {
    const codigo = dados.codigo.trim().toUpperCase();

    if (!codigo) {
      socket.emit("erroAluno", {
        mensagem: "Digite o código da aula antes de enviar."
      });
      return;
    }

    if (!aulas[codigo]) {
      socket.emit("erroAluno", {
        mensagem: "Código da aula não encontrado. Confira o código com o professor."
      });
      return;
    }

    const alunoId = dados.alunoId;
    const chaveAluno = codigo + "-" + alunoId;
    const agora = Date.now();

    const ultimoEnvio = ultimoEnvioPorAluno[chaveAluno] || 0;
    const tempoPassado = agora - ultimoEnvio;

    if (tempoPassado < TEMPO_ESPERA) {
      const segundosRestantes = Math.ceil((TEMPO_ESPERA - tempoPassado) / 1000);

      socket.emit("aguardeEnvio", {
        mensagem: `Aguarde ${segundosRestantes} segundo(s) para enviar outra dúvida.`
      });

      return;
    }

    const pergunta = {
      id: contadorId++,
      alunoId: alunoId,
      codigo: codigo,
      nome: dados.nome && dados.nome.trim() !== "" ? dados.nome : "Anônimo",
      texto: dados.texto,
      horario: new Date().toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };

    aulas[codigo].perguntas.push(pergunta);
    ultimoEnvioPorAluno[chaveAluno] = agora;

    salvarDados();

    socket.emit("perguntaEnviada", {
      mensagem: "Dúvida enviada com sucesso!"
    });

    io.to("aula-" + codigo).emit("listaPerguntas", aulas[codigo].perguntas);
    io.to("aula-" + codigo).emit("notificacaoProfessor");
  });

  socket.on("marcarRespondida", (dados) => {
    const codigo = dados.codigo;
    const id = dados.id;

    if (!aulas[codigo]) {
      return;
    }

    aulas[codigo].perguntas = aulas[codigo].perguntas.filter(
      (pergunta) => pergunta.id !== id
    );

    salvarDados();

    io.to("aula-" + codigo).emit("listaPerguntas", aulas[codigo].perguntas);
  });

  socket.on("encerrarAula", (dados) => {
    const codigo = dados.codigo;

    if (!aulas[codigo]) {
      return;
    }

    delete aulas[codigo];

    salvarDados();

    io.to("aula-" + codigo).emit("aulaEncerrada", {
      mensagem: "A aula foi encerrada. O código não está mais disponível."
    });
  });
});

const PORTA = process.env.PORT || 3000;

server.listen(PORTA, "0.0.0.0", () => {
  console.log("Servidor rodando na porta " + PORTA);
});