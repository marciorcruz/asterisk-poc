package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

type registerReq struct {
	Name     string `json:"name"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

type loginReq struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func handleRegister(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "método não permitido", http.StatusMethodNotAllowed)
		return
	}

	var req registerReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonErr(w, "json inválido", http.StatusBadRequest)
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))

	if req.Name == "" || req.Email == "" || len(req.Password) < 6 {
		jsonErr(w, "name, email e senha (mín. 6 chars) são obrigatórios", http.StatusBadRequest)
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		jsonErr(w, "erro interno", http.StatusInternalServerError)
		return
	}

	ext, err := nextExtension(db)
	if err != nil {
		jsonErr(w, "erro ao gerar ramal", http.StatusInternalServerError)
		return
	}

	user := &User{
		Name:        req.Name,
		Email:       req.Email,
		Password:    string(hash),
		SIPPassword: randomHex(8), // senha SIP gerada automaticamente
		Extension:   ext,
	}

	if err := createUser(db, user); err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			jsonErr(w, "e-mail já cadastrado", http.StatusConflict)
			return
		}
		jsonErr(w, "erro ao criar usuário", http.StatusInternalServerError)
		return
	}

	if err := syncAsterisk(db); err != nil {
		log.Printf("WARN: sync asterisk falhou: %v", err)
	}

	token, err := generateToken(user.ID)
	if err != nil {
		jsonErr(w, "erro ao gerar token", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
	jsonOK(w, map[string]any{
		"token":        token,
		"name":         user.Name,
		"extension":    user.Extension,
		"sip_password": user.SIPPassword,
	})
}

func handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "método não permitido", http.StatusMethodNotAllowed)
		return
	}

	var req loginReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonErr(w, "json inválido", http.StatusBadRequest)
		return
	}

	user, err := getUserByEmail(db, strings.ToLower(strings.TrimSpace(req.Email)))
	if err != nil || user == nil {
		jsonErr(w, "credenciais inválidas", http.StatusUnauthorized)
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password)); err != nil {
		jsonErr(w, "credenciais inválidas", http.StatusUnauthorized)
		return
	}

	token, err := generateToken(user.ID)
	if err != nil {
		jsonErr(w, "erro ao gerar token", http.StatusInternalServerError)
		return
	}

	jsonOK(w, map[string]any{
		"token":        token,
		"name":         user.Name,
		"extension":    user.Extension,
		"sip_password": user.SIPPassword,
	})
}

func handleMe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		jsonErr(w, "método não permitido", http.StatusMethodNotAllowed)
		return
	}
	userID := r.Context().Value(ctxUserID).(int64)
	user, err := getUserByID(db, userID)
	if err != nil || user == nil {
		jsonErr(w, "usuário não encontrado", http.StatusNotFound)
		return
	}
	jsonOK(w, map[string]any{
		"id":        user.ID,
		"name":      user.Name,
		"email":     user.Email,
		"extension": user.Extension,
	})
}
