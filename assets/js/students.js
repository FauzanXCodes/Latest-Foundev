
/* =========================================================
   FOUNDEV INSTITUTION WORKSPACE
   Purchased Projects & Student Teams
   File: assets/js/students.js

   API:
   ../api/admin/students.php?action=list

   Uses the actual API response:
   data.institution
   data.administrator
   data.purchases[]
   ========================================================= */

(() => {
    "use strict";

    const API_URL = "../api/admin/students.php";
    const PAGE_SIZE = 10;

    const state = {
        purchases: [],
        filteredPurchases: [],
        currentPage: 1,
        selectedPurchase: null,
        loading: false,
        error: null
    };

    const $ = (selector, root = document) => root.querySelector(selector);

    const elements = {
        institutionName: $("#institution-name"),
        institutionInitial: $("#institution-initial"),
        adminName: $("#admin-name"),
        adminEmail: $("#admin-email"),
        adminInitial: $("#admin-initial"),

        systemStatus: $("#system-status"),
        systemStatusText: $("#system-status-text"),
        dashboardDate: $("#dashboard-date"),
        currentYear: $("#current-year"),

        total: $("#students-total"),
        pending: $("#students-pending"),
        paymentPending: $("#students-payment-pending"),
        approved: $("#students-approved"),

        search: $("#student-search"),
        statusFilter: $("#student-status-filter"),
        paymentFilter: $("#student-payment-filter"),
        sort: $("#student-sort"),
        resultCount: $("#students-result-count"),
        clearFilters: $("#clear-student-filters"),

        loading: $("#students-loading"),
        error: $("#students-error"),
        errorMessage: $("#students-error-message"),
        empty: $("#students-empty"),
        emptyTitle: $("#students-empty-title"),
        emptyDescription: $("#students-empty-description"),

        tableWrap: $("#students-table-wrap"),
        tableBody: $("#students-table-body"),
        mobileList: $("#students-mobile-list"),

        pagination: $("#students-pagination"),
        paginationInfo: $("#students-pagination-info"),
        pageNumber: $("#students-page-number"),
        previousPage: $("#students-previous-page"),
        nextPage: $("#students-next-page"),

        refresh: $("#refresh-students-button"),
        retry: $("#retry-students-button"),
        export: $("#export-students-button"),

        dialog: $("#student-dialog"),
        closeDialog: $("#close-student-dialog"),
        cancelDialog: $("#cancel-student-dialog"),

        reviewTeamName: $("#review-team-name"),
        reviewTeamLeader: $("#review-team-leader"),
        reviewTeamEmail: $("#review-team-email"),
        reviewProjectName: $("#review-project-name"),
        reviewProjectFee: $("#review-project-fee"),
        reviewSubmittedDate: $("#review-submitted-date"),
        reviewMembers: $("#review-team-members"),

        reviewPaymentStatus: $("#review-payment-status"),
        reviewPaymentReference: $("#review-payment-reference"),
        reviewPaymentAmount: $("#review-payment-amount"),
        reviewPaymentNote: $("#review-payment-note"),

        confirmPayment: $("#confirm-payment-checkbox"),
        adminNote: $("#review-admin-note"),
        formMessage: $("#student-form-message"),

        verifyPayment: $("#verify-payment-button"),
        approve: $("#approve-student-button"),
        reject: $("#reject-student-button"),

        logout: $("#logout-button")
    };

    /* =====================================================
       UTILITIES
    ===================================================== */

    function escapeHTML(value) {
        return String(value ?? "").replace(/[&<>"']/g, character => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[character]);
    }

    function getValue(object, keys, fallback = "") {
        for (const key of keys) {
            const value = object?.[key];

            if (value !== undefined && value !== null && value !== "") {
                return value;
            }
        }

        return fallback;
    }

    function initials(value) {
        return String(value || "F")
            .trim()
            .split(/\s+/)
            .slice(0, 2)
            .map(part => part.charAt(0))
            .join("")
            .toUpperCase();
    }

    function formatDate(value) {
        if (!value) return "—";

        const date = new Date(String(value).replace(" ", "T"));

        if (Number.isNaN(date.getTime())) {
            return String(value);
        }

        return new Intl.DateTimeFormat("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric"
        }).format(date);
    }

    function formatCurrency(value, currency = "INR") {
        const amount = Number(value);

        if (!Number.isFinite(amount)) {
            return "Not available";
        }

        try {
            return new Intl.NumberFormat("en-IN", {
                style: "currency",
                currency,
                maximumFractionDigits: 2
            }).format(amount);
        } catch {
            return `${currency} ${amount.toFixed(2)}`;
        }
    }

    function getPurchaseStatus(purchase) {
        return String(purchase?.access_status || "active").toLowerCase();
    }

    function getPaymentStatus(purchase) {
        return String(purchase?.payment_status || "").toLowerCase();
    }

    function getPurchaseType(purchase) {
        return String(purchase?.purchase_type || "individual").toLowerCase();
    }

    function getPurchaseName(purchase) {
        return getValue(
            purchase,
            ["team_name", "project_name"],
            "Project purchase"
        );
    }

    function getLeader(purchase) {
        const members = Array.isArray(purchase?.members)
            ? purchase.members
            : [];

        return members[0] || {};
    }

    function getLeaderName(purchase) {
        const leader = getLeader(purchase);

        return getValue(
            leader,
            ["full_name", "name"],
            "Student details unavailable"
        );
    }

    function getLeaderEmail(purchase) {
        return getValue(
            getLeader(purchase),
            ["email"],
            "Not provided"
        );
    }

    function getMembers(purchase) {
        return Array.isArray(purchase?.members)
            ? purchase.members
            : [];
    }

    function setSystemStatus(status, message) {
        if (elements.systemStatus) {
            elements.systemStatus.dataset.status = status;
        }

        if (elements.systemStatusText) {
            elements.systemStatusText.textContent = message;
        }
    }

    function setBusy(button, busy, label = "Please wait…") {
        if (!button) return;

        if (!button.dataset.originalHTML) {
            button.dataset.originalHTML = button.innerHTML;
        }

        button.disabled = busy;

        button.textContent = busy
            ? label
            : "";

        if (!busy) {
            button.innerHTML = button.dataset.originalHTML;
        }
    }

    /* =====================================================
       API
    ===================================================== */

    async function apiRequest(action = "list", payload = null) {
        const url = new URL(API_URL, window.location.href);

        const options = {
            method: payload ? "POST" : "GET",
            credentials: "same-origin",
            headers: {
                Accept: "application/json"
            }
        };

        if (payload) {
            options.headers["Content-Type"] = "application/json";

            options.body = JSON.stringify({
                ...payload,
                action
            });
        } else {
            url.searchParams.set("action", action);
        }

        const response = await fetch(url.toString(), options);

        let result;

        try {
            result = await response.json();
        } catch {
            throw new Error(
                `Invalid server response (HTTP ${response.status}).`
            );
        }

        if (response.status === 401 || response.status === 403) {
            throw new Error(
                result.message || "Your session has expired. Please sign in again."
            );
        }

        if (!response.ok || result.success !== true) {
            throw new Error(
                result.message || `Request failed (HTTP ${response.status}).`
            );
        }

        return result;
    }

    /* =====================================================
       WORKSPACE IDENTITY
    ===================================================== */

    function updateWorkspaceIdentity(data) {
        const institution = data?.institution || {};
        const admin = data?.administrator || {};

        const institutionName = getValue(institution, ["name"], "");
        const adminName = getValue(admin, ["name"], "");
        const adminEmail = getValue(admin, ["email"], "");

        if (elements.institutionName) {
            elements.institutionName.textContent = institutionName || "Institution";
        }

        if (elements.institutionInitial) {
            elements.institutionInitial.textContent = initials(institutionName);
        }

        if (elements.adminName) {
            elements.adminName.textContent = adminName || "Administrator";
        }

        if (elements.adminEmail) {
            elements.adminEmail.textContent = adminEmail;
        }

        if (elements.adminInitial) {
            elements.adminInitial.textContent = initials(adminName);
        }
    }

    /* =====================================================
       PAGE STATES
    ===================================================== */

    function setPageState(mode) {
        if (elements.loading) {
            elements.loading.hidden = mode !== "loading";
        }

        if (elements.error) {
            elements.error.hidden = mode !== "error";
        }

        if (elements.empty) {
            elements.empty.hidden = mode !== "empty";
        }

        if (elements.tableWrap) {
            elements.tableWrap.hidden = mode !== "content";
        }

        if (elements.mobileList) {
            elements.mobileList.hidden = mode !== "content";
        }

        if (elements.pagination) {
            elements.pagination.hidden =
                mode !== "content" ||
                state.filteredPurchases.length === 0;
        }
    }

    function showError(message) {
        state.error = message;

        if (elements.errorMessage) {
            elements.errorMessage.textContent = message;
        }

        setPageState("error");
        setSystemStatus("error", "Connection issue");
    }

    /* =====================================================
       SUMMARY METRICS
    ===================================================== */

    function updateSummary() {
        const purchases = state.purchases;

        const active = purchases.filter(purchase =>
            getPurchaseStatus(purchase) === "active"
        ).length;

        const expired = purchases.filter(purchase =>
            getPurchaseStatus(purchase) === "expired"
        ).length;

        const paid = purchases.filter(purchase =>
            ["paid", "completed"].includes(getPaymentStatus(purchase))
        ).length;

        if (elements.total) {
            elements.total.textContent =
                purchases.length.toLocaleString("en-IN");
        }

        if (elements.pending) {
            elements.pending.textContent =
                expired.toLocaleString("en-IN");
        }

        if (elements.paymentPending) {
            elements.paymentPending.textContent =
                purchases.filter(purchase =>
                    !["paid", "completed"].includes(getPaymentStatus(purchase))
                ).length.toLocaleString("en-IN");
        }

        if (elements.approved) {
            elements.approved.textContent =
                active.toLocaleString("en-IN");
        }
    }

    /* =====================================================
       STATUS PRESENTATION
    ===================================================== */

    function paymentStatusLabel(purchase) {
        const status = getPaymentStatus(purchase);

        if (["paid", "completed"].includes(status)) return "Paid";
        if (status === "pending") return "Pending";
        if (status === "failed") return "Failed";

        return status || "Unknown";
    }

    function paymentStatusClass(purchase) {
        const status = getPaymentStatus(purchase);

        if (["paid", "completed"].includes(status)) {
            return "students-status-payment-verified";
        }

        if (status === "failed") {
            return "students-status-payment-rejected";
        }

        return "students-status-payment-pending";
    }

    function accessStatusLabel(purchase) {
        const status = getPurchaseStatus(purchase);

        if (status === "active") return "Active";
        if (status === "expired") return "Expired";
        if (status === "pending") return "Pending";

        return status;
    }

    function accessStatusClass(purchase) {
        const status = getPurchaseStatus(purchase);

        if (status === "active") {
            return "students-status-approved";
        }

        if (status === "expired") {
            return "students-status-rejected";
        }

        return "students-status-pending-review";
    }

    function statusBadge(label, className) {
        return `
            <span class="students-status ${className}">
                ${escapeHTML(label)}
            </span>
        `;
    }

    /* =====================================================
       RENDER TABLE
    ===================================================== */

    function renderTable(purchases) {
        if (!elements.tableBody) return;

        elements.tableBody.innerHTML = purchases.map(purchase => {
            const id = purchase.id;
            const projectName = purchase.project_name || "Project";
            const teamName = getPurchaseName(purchase);
            const members = getMembers(purchase);

            const type = getPurchaseType(purchase);

            return `
                <tr>
                    <td>
                        <div class="students-team-cell">
                            <span class="students-team-avatar">
                                ${escapeHTML(initials(teamName))}
                            </span>

                            <span class="students-team-copy">
                                <span class="students-team-name">
                                    ${escapeHTML(teamName)}
                                </span>

                                <span class="students-team-leader">
                                    ${type === "team" ? "Team purchase" : "Individual purchase"}
                                </span>
                            </span>
                        </div>
                    </td>

                    <td>
                        <span class="students-project-name">
                            ${escapeHTML(projectName)}
                        </span>

                        <span class="students-project-category">
                            ${escapeHTML(purchase.project_category || "")}
                        </span>
                    </td>

                    <td>
                        <span class="students-member-count">
                            ${members.length}
                            ${members.length === 1 ? "member" : "members"}
                        </span>
                    </td>

                    <td>
                        ${statusBadge(
                            paymentStatusLabel(purchase),
                            paymentStatusClass(purchase)
                        )}
                    </td>

                    <td>
                        ${statusBadge(
                            accessStatusLabel(purchase),
                            accessStatusClass(purchase)
                        )}
                    </td>

                    <td>
                        <span class="students-table-date">
                            ${escapeHTML(formatDate(purchase.paid_at || purchase.created_at))}
                        </span>
                    </td>

                    <td>
                        <div class="students-row-actions">
                            <button
                                type="button"
                                class="students-review-button"
                                data-review-id="${escapeHTML(String(id))}"
                            >
                                View details
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join("");
    }

    /* =====================================================
       RENDER MOBILE CARDS
    ===================================================== */

    function renderMobileCards(purchases) {
        if (!elements.mobileList) return;

        elements.mobileList.innerHTML = purchases.map(purchase => {
            const members = getMembers(purchase);

            return `
                <article class="students-mobile-card">
                    <div class="students-mobile-card-header">
                        <div class="students-mobile-team">
                            <span class="students-team-avatar">
                                ${escapeHTML(initials(getPurchaseName(purchase)))}
                            </span>

                            <div class="students-mobile-team-copy">
                                <h3>${escapeHTML(getPurchaseName(purchase))}</h3>
                                <p>${escapeHTML(purchase.project_name || "Project")}</p>
                            </div>
                        </div>

                        ${statusBadge(
                            accessStatusLabel(purchase),
                            accessStatusClass(purchase)
                        )}
                    </div>

                    <div class="students-mobile-details">
                        <div class="students-mobile-detail">
                            <span class="students-mobile-detail-label">Members</span>
                            <span class="students-mobile-detail-value">
                                ${members.length}
                            </span>
                        </div>

                        <div class="students-mobile-detail">
                            <span class="students-mobile-detail-label">Payment</span>
                            ${statusBadge(
                                paymentStatusLabel(purchase),
                                paymentStatusClass(purchase)
                            )}
                        </div>

                        <div class="students-mobile-detail">
                            <span class="students-mobile-detail-label">Amount</span>
                            <span class="students-mobile-detail-value">
                                ${escapeHTML(formatCurrency(
                                    purchase.amount_paid,
                                    purchase.currency || "INR"
                                ))}
                            </span>
                        </div>

                        <div class="students-mobile-detail">
                            <span class="students-mobile-detail-label">Purchased</span>
                            <span class="students-mobile-detail-value">
                                ${escapeHTML(formatDate(purchase.paid_at || purchase.created_at))}
                            </span>
                        </div>
                    </div>

                    <div class="students-mobile-card-footer">
                        <span>Project purchase</span>

                        <button
                            type="button"
                            class="students-review-button"
                            data-review-id="${escapeHTML(String(purchase.id))}"
                        >
                            View details
                        </button>
                    </div>
                </article>
            `;
        }).join("");
    }

    /* =====================================================
       SEARCH, FILTER AND SORT
    ===================================================== */

    function searchableText(purchase) {
        const members = getMembers(purchase);

        const memberText = members.map(member => [
            member.full_name,
            member.username,
            member.email
        ].join(" ")).join(" ");

        return [
            purchase.id,
            purchase.order_reference,
            purchase.project_name,
            purchase.project_category,
            purchase.team_name,
            purchase.cashfree_payment_id,
            memberText
        ].join(" ").toLowerCase();
    }

    function matchesStatusFilter(purchase, filter) {
        if (!filter) return true;

        return getPurchaseStatus(purchase) === filter;
    }

    function matchesPaymentFilter(purchase, filter) {
        if (!filter) return true;

        const status = getPaymentStatus(purchase);

        if (filter === "verified") {
            return ["paid", "completed"].includes(status);
        }

        if (filter === "unpaid") {
            return !["paid", "completed"].includes(status);
        }

        return status === filter;
    }

    function sortPurchases(purchases) {
        const sorted = [...purchases];
        const sort = elements.sort?.value || "newest";

        sorted.sort((a, b) => {
            const dateA = new Date(a.paid_at || a.created_at || 0).getTime() || 0;
            const dateB = new Date(b.paid_at || b.created_at || 0).getTime() || 0;

            switch (sort) {
                case "oldest":
                    return dateA - dateB;

                case "team-asc":
                    return getPurchaseName(a).localeCompare(getPurchaseName(b));

                case "team-desc":
                    return getPurchaseName(b).localeCompare(getPurchaseName(a));

                case "newest":
                default:
                    return dateB - dateA;
            }
        });

        return sorted;
    }

    function applyFilters() {
        const query = (elements.search?.value || "").trim().toLowerCase();
        const status = elements.statusFilter?.value || "";
        const payment = elements.paymentFilter?.value || "";

        let filtered = state.purchases.filter(purchase => {
            return (
                (!query || searchableText(purchase).includes(query)) &&
                matchesStatusFilter(purchase, status) &&
                matchesPaymentFilter(purchase, payment)
            );
        });

        filtered = sortPurchases(filtered);

        state.filteredPurchases = filtered;

        const totalPages = Math.max(
            1,
            Math.ceil(filtered.length / PAGE_SIZE)
        );

        state.currentPage = Math.min(state.currentPage, totalPages);
        state.currentPage = Math.max(1, state.currentPage);

        renderCurrentPage();

        if (elements.clearFilters) {
            elements.clearFilters.hidden = !(
                query ||
                status ||
                payment ||
                (elements.sort?.value && elements.sort.value !== "newest")
            );
        }
    }

    /* =====================================================
       PAGINATION
    ===================================================== */

    function renderCurrentPage() {
        const purchases = state.filteredPurchases;
        const total = purchases.length;

        const totalPages = Math.max(
            1,
            Math.ceil(total / PAGE_SIZE)
        );

        const startIndex = (state.currentPage - 1) * PAGE_SIZE;

        const pagePurchases = purchases.slice(
            startIndex,
            startIndex + PAGE_SIZE
        );

        if (elements.resultCount) {
            elements.resultCount.textContent =
                `${total.toLocaleString("en-IN")} purchases found`;
        }

        if (state.loading) {
            setPageState("loading");
            return;
        }

        if (state.error) {
            setPageState("error");
            return;
        }

        if (total === 0) {
            if (elements.emptyTitle) {
                elements.emptyTitle.textContent =
                    state.purchases.length
                        ? "No matching purchases"
                        : "No purchased projects yet";
            }

            if (elements.emptyDescription) {
                elements.emptyDescription.textContent =
                    state.purchases.length
                        ? "Try changing your search or filters."
                        : "Paid project purchases will appear here.";
            }

            setPageState("empty");
            return;
        }

        setPageState("content");

        renderTable(pagePurchases);
        renderMobileCards(pagePurchases);

        if (elements.paginationInfo) {
            elements.paginationInfo.textContent =
                `Showing ${startIndex + 1}–${Math.min(
                    startIndex + PAGE_SIZE,
                    total
                )} of ${total} purchases`;
        }

        if (elements.pageNumber) {
            elements.pageNumber.textContent =
                `Page ${state.currentPage} of ${totalPages}`;
        }

        if (elements.previousPage) {
            elements.previousPage.disabled = state.currentPage <= 1;
        }

        if (elements.nextPage) {
            elements.nextPage.disabled = state.currentPage >= totalPages;
        }
    }

    /* =====================================================
       LOAD PURCHASES
    ===================================================== */

    async function loadPurchases() {
        if (state.loading) return;

        state.loading = true;
        state.error = null;

        setPageState("loading");
        setBusy(elements.refresh, true, "Refreshing…");

        setSystemStatus("loading", "Loading purchases");

        try {
            const result = await apiRequest("list");

            const data = result.data || {};

            if (!Array.isArray(data.purchases)) {
                throw new Error(
                    "The API response does not contain data.purchases."
                );
            }

            state.purchases = data.purchases;
            state.error = null;

            updateWorkspaceIdentity(data);
            updateSummary();

            state.currentPage = 1;
            state.loading = false;

            setSystemStatus("connected", "Connected");

            applyFilters();

        } catch (error) {
            state.loading = false;

            showError(
                error.message || "Unable to load purchased projects."
            );

        } finally {
            setBusy(elements.refresh, false);
        }
    }

    /* =====================================================
       PURCHASE DETAILS DIALOG
    ===================================================== */

    function setText(element, value) {
        if (element) {
            element.textContent =
                value === null || value === undefined || value === ""
                    ? "—"
                    : String(value);
        }
    }

    function renderMembers(members) {
        if (!elements.reviewMembers) return;

        if (!members.length) {
            elements.reviewMembers.innerHTML =
                "<p>No student details available.</p>";

            return;
        }

        elements.reviewMembers.innerHTML = members.map((member, index) => `
            <div class="students-member-row">
                <div>
                    <span class="students-member-label">Student name</span>
                    <span class="students-member-value">
                        ${escapeHTML(member.full_name || `Member ${index + 1}`)}
                    </span>
                </div>

                <div>
                    <span class="students-member-label">Username</span>
                    <span class="students-member-value">
                        ${escapeHTML(member.username || "Not available")}
                    </span>
                </div>

                <div>
                    <span class="students-member-label">Email</span>
                    <span class="students-member-value">
                        ${escapeHTML(member.email || "Not provided")}
                    </span>
                </div>
            </div>
        `).join("");
    }

    function openPurchaseDetails(id) {
        const purchase = state.purchases.find(
            item => String(item.id) === String(id)
        );

        if (!purchase || !elements.dialog) return;

        state.selectedPurchase = purchase;

        const members = getMembers(purchase);

        const firstMember = members[0] || {};

        setText(
            elements.reviewTeamName,
            purchase.team_name || purchase.project_name
        );

        setText(
            elements.reviewTeamLeader,
            firstMember.full_name || "Not available"
        );

        setText(
            elements.reviewTeamEmail,
            firstMember.email || "Not provided"
        );

        setText(
            elements.reviewProjectName,
            purchase.project_name
        );

        setText(
            elements.reviewProjectFee,
            formatCurrency(purchase.amount_paid, purchase.currency || "INR")
        );

        setText(
            elements.reviewSubmittedDate,
            formatDate(purchase.paid_at || purchase.created_at)
        );

        setText(
            elements.reviewPaymentStatus,
            paymentStatusLabel(purchase)
        );

        setText(
            elements.reviewPaymentReference,
            purchase.cashfree_payment_id || purchase.order_reference
        );

        setText(
            elements.reviewPaymentAmount,
            formatCurrency(purchase.amount_paid, purchase.currency || "INR")
        );

        if (elements.reviewPaymentNote) {
            elements.reviewPaymentNote.textContent =
                `Access: ${accessStatusLabel(purchase)} | ` +
                `Expires: ${formatDate(purchase.access_expires_at)}`;
        }

        renderMembers(members);

        /*
         * These actions are not supported by the current PHP API.
         * Hide them rather than showing buttons that cannot work.
         */

        [
            elements.verifyPayment,
            elements.approve,
            elements.reject,
            elements.confirmPayment,
            elements.adminNote
        ].forEach(element => {
            if (element) {
                element.hidden = true;
            }
        });

        if (elements.formMessage) {
            elements.formMessage.hidden = true;
        }

        if (elements.dialog && !elements.dialog.open) {
            elements.dialog.showModal();
        }
    }

    function closePurchaseDetails() {
        if (elements.dialog?.open) {
            elements.dialog.close();
        }

        state.selectedPurchase = null;
    }

    /* =====================================================
       CSV EXPORT
    ===================================================== */

    function csvEscape(value) {
        return `"${String(value ?? "").replace(/"/g, '""')}"`;
    }

    function exportPurchases() {
        const purchases = state.filteredPurchases;

        if (!purchases.length) {
            window.alert("There are no purchases to export.");
            return;
        }

        const headings = [
            "Purchase ID",
            "Order Reference",
            "Project",
            "Purchase Type",
            "Team Name",
            "Student Name",
            "Username",
            "Email",
            "Payment Status",
            "Payment Reference",
            "Amount",
            "Currency",
            "Access Status",
            "Access Expiry",
            "Purchase Date"
        ];

        const rows = [];

        purchases.forEach(purchase => {
            const members = getMembers(purchase);

            if (!members.length) {
                rows.push([
                    purchase.id,
                    purchase.order_reference,
                    purchase.project_name,
                    purchase.purchase_type,
                    purchase.team_name,
                    "",
                    "",
                    "",
                    purchase.payment_status,
                    purchase.cashfree_payment_id,
                    purchase.amount_paid,
                    purchase.currency,
                    purchase.access_status,
                    purchase.access_expires_at,
                    purchase.paid_at || purchase.created_at
                ]);
            } else {
                members.forEach(member => {
                    rows.push([
                        purchase.id,
                        purchase.order_reference,
                        purchase.project_name,
                        purchase.purchase_type,
                        purchase.team_name,
                        member.full_name,
                        member.username,
                        member.email,
                        purchase.payment_status,
                        purchase.cashfree_payment_id,
                        purchase.amount_paid,
                        purchase.currency,
                        purchase.access_status,
                        purchase.access_expires_at,
                        purchase.paid_at || purchase.created_at
                    ]);
                });
            }
        });

        const csv = [
            headings,
            ...rows
        ].map(row => row.map(csvEscape).join(",")).join("\r\n");

        const blob = new Blob(
            ["\uFEFF", csv],
            { type: "text/csv;charset=utf-8;" }
        );

        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");

        anchor.href = url;

        anchor.download =
            `foundev-purchases-${new Date().toISOString().slice(0, 10)}.csv`;

        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();

        URL.revokeObjectURL(url);
    }

    /* =====================================================
       ACCOUNT MENU AND LOGOUT
    ===================================================== */

    function initializeAccountMenu() {
        const menuButton = $("#account-menu-button");
        const menu = $("#account-menu");

        if (!menuButton || !menu) return;

        menuButton.addEventListener("click", event => {
            event.stopPropagation();

            const isOpen =
                menuButton.getAttribute("aria-expanded") === "true";

            menuButton.setAttribute("aria-expanded", String(!isOpen));
            menu.hidden = isOpen;
        });

        document.addEventListener("click", event => {
            if (
                !menu.contains(event.target) &&
                !menuButton.contains(event.target)
            ) {
                menu.hidden = true;
                menuButton.setAttribute("aria-expanded", "false");
            }
        });
    }

    async function logout() {
        if (!window.confirm("Are you sure you want to sign out?")) {
            return;
        }

        setBusy(elements.logout, true, "Signing out…");

        try {
            await apiRequest("logout", {});
        } catch (error) {
            console.warn("Logout response:", error.message);
        } finally {
            window.location.href = "login.html";
        }
    }

    /* =====================================================
       EVENTS
    ===================================================== */

    function bindEvents() {
        elements.refresh?.addEventListener("click", loadPurchases);
        elements.retry?.addEventListener("click", loadPurchases);
        elements.export?.addEventListener("click", exportPurchases);

        elements.search?.addEventListener("input", () => {
            state.currentPage = 1;
            applyFilters();
        });

        elements.statusFilter?.addEventListener("change", () => {
            state.currentPage = 1;
            applyFilters();
        });

        elements.paymentFilter?.addEventListener("change", () => {
            state.currentPage = 1;
            applyFilters();
        });

        elements.sort?.addEventListener("change", () => {
            state.currentPage = 1;
            applyFilters();
        });

        elements.clearFilters?.addEventListener("click", () => {
            if (elements.search) elements.search.value = "";
            if (elements.statusFilter) elements.statusFilter.value = "";
            if (elements.paymentFilter) elements.paymentFilter.value = "";
            if (elements.sort) elements.sort.value = "newest";

            state.currentPage = 1;
            applyFilters();
        });

        elements.previousPage?.addEventListener("click", () => {
            if (state.currentPage > 1) {
                state.currentPage--;
                renderCurrentPage();
            }
        });

        elements.nextPage?.addEventListener("click", () => {
            const totalPages = Math.max(
                1,
                Math.ceil(state.filteredPurchases.length / PAGE_SIZE)
            );

            if (state.currentPage < totalPages) {
                state.currentPage++;
                renderCurrentPage();
            }
        });

        document.addEventListener("click", event => {
            const button = event.target.closest("[data-review-id]");

            if (!button) return;

            openPurchaseDetails(button.dataset.reviewId);
        });

        elements.closeDialog?.addEventListener(
            "click",
            closePurchaseDetails
        );

        elements.cancelDialog?.addEventListener(
            "click",
            closePurchaseDetails
        );

        elements.dialog?.addEventListener("click", event => {
            if (event.target === elements.dialog) {
                closePurchaseDetails();
            }
        });

        elements.logout?.addEventListener("click", logout);

        document.addEventListener("keydown", event => {
            const target = event.target;

            const isTyping = target instanceof HTMLElement && (
                target.isContentEditable ||
                ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
            );

            if (
                event.key === "/" &&
                !isTyping &&
                !event.ctrlKey &&
                !event.metaKey &&
                !event.altKey
            ) {
                event.preventDefault();
                elements.search?.focus();
            }
        });
    }

    /* =====================================================
       INITIALIZATION
    ===================================================== */

    function initializePage() {
        if (elements.dashboardDate) {
            elements.dashboardDate.textContent =
                new Intl.DateTimeFormat("en-IN", {
                    weekday: "short",
                    day: "2-digit",
                    month: "short",
                    year: "numeric"
                }).format(new Date());
        }

        if (elements.currentYear) {
            elements.currentYear.textContent =
                String(new Date().getFullYear());
        }

        initializeAccountMenu();
        bindEvents();
        loadPurchases();
    }

    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            initializePage,
            { once: true }
        );
    } else {
        initializePage();
    }

})();
