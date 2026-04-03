package main

import (
	"database/sql"
	"fmt"
	"net"
	"os"
	"strings"
	"text/template"
	"time"
)

const pjsipTmpl = `; Gerado automaticamente pela API — não editar
; Atualizado: {{.Timestamp}}
{{range .Users}}
[{{.Extension}}](webrtc-aor)

[{{.Extension}}-auth](auth-userpass)
username={{.Extension}}
password={{.SIPPassword}}

[{{.Extension}}](webrtc-endpoint)
aors={{.Extension}}
auth={{.Extension}}-auth
callerid="{{.Name}}" <{{.Extension}}>
{{end}}`

func syncAsterisk(db *sql.DB) error {
	users, err := allUsers(db)
	if err != nil {
		return err
	}

	tmpl, err := template.New("pjsip").Parse(pjsipTmpl)
	if err != nil {
		return err
	}

	f, err := os.Create(confPath)
	if err != nil {
		return fmt.Errorf("criar %s: %w", confPath, err)
	}
	defer f.Close()

	if err := tmpl.Execute(f, map[string]any{
		"Timestamp": time.Now().Format("2006-01-02 15:04:05"),
		"Users":     users,
	}); err != nil {
		return err
	}

	return reloadPJSIP()
}

func reloadPJSIP() error {
	conn, err := net.DialTimeout("tcp", amiAddr, 5*time.Second)
	if err != nil {
		return fmt.Errorf("AMI connect: %w", err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(10 * time.Second))

	// Envia login + pjsip reload + logoff de uma vez
	_, err = fmt.Fprintf(conn,
		"Action: Login\r\nUsername: %s\r\nSecret: %s\r\n\r\n"+
			"Action: Command\r\nCommand: pjsip reload\r\n\r\n"+
			"Action: Logoff\r\n\r\n",
		amiUser, amiSecret,
	)
	if err != nil {
		return fmt.Errorf("AMI write: %w", err)
	}

	// Lê toda a resposta até o Goodbye ou timeout
	buf := make([]byte, 8192)
	var sb strings.Builder
	for {
		n, readErr := conn.Read(buf)
		if n > 0 {
			sb.Write(buf[:n])
		}
		if readErr != nil || strings.Contains(sb.String(), "Response: Goodbye") {
			break
		}
	}

	output := sb.String()
	if !strings.Contains(output, "Authentication accepted") {
		return fmt.Errorf("AMI login falhou: %s", output)
	}
	return nil
}
