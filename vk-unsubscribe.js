(async () => {
  if (window.vkLeaveAll) return console.warn("Уже запущено.");

  const state = window.vkLeaveAll = { stop: false };
  const seen = new Set();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const visible = el => el.getClientRects().length > 0;
  const text = el => (el.innerText || el.value || "")
    .replace(/\s+/g, " ").trim();

  const warning =
    "Это закрытое сообщество. Если вы отпишетесь, попасть " +
    "обратно, возможно, будет непросто. Отписаться от сообщества?";

  let done = 0;

  class RetryableError extends Error {}

  const isLeft = row => row?.isConnected &&
    /(^|\s)(Подписаться|Подать заявку)(\s|$)/.test(text(row));

  function guard(allowClosed = false) {
    if (state.stop) throw Error("Остановлено пользователем.");
    if (location.pathname !== "/groups/my_all_groups") {
      throw Error("Страница изменилась.");
    }

    const dialogs = [...document.querySelectorAll(
      '[role="dialog"], [role="alertdialog"], .box_layout'
    )].filter(el =>
      visible(el) &&
      !el.closest('[data-testid="dropdownactionsheet"]')
    );

    const roots = dialogs.filter(el =>
      !dialogs.some(other => other !== el && other.contains(el))
    );

    if (!roots.length) return null;

    if (
      allowClosed &&
      roots.length === 1 &&
      text(roots[0]).includes(warning)
    ) {
      return roots[0];
    }

    throw Error("Неизвестное окно или проверка ВК — проверьте вручную.");
  }

  async function waitFor(check, allowClosed = false) {
    const until = Date.now() + 10000;
    let warningConfirmed = false;

    while (Date.now() < until) {
      const dialog = guard(allowClosed);

      if (dialog && !warningConfirmed) {
        const buttons = [...dialog.querySelectorAll(
          'button, [role="button"], input[type="button"]'
        )].filter(el => visible(el) && text(el) === "Отписаться");

        if (buttons.length !== 1) {
          throw Error("Не удалось однозначно найти подтверждение.");
        }

        warningConfirmed = true;
        buttons[0].click();
      }

      const result = check();
      if (result && !dialog) return result;
      await sleep(150);
    }

    throw new RetryableError("Не удалось подтвердить отписку или дождаться меню.");
  }

  function nextGroup() {
    for (const button of document.querySelectorAll(
      '[data-testid="desktop_group_item_button"]'
    )) {
      const row = button.closest("a[href]");
      if (!row || /Подписаться|Подать заявку/.test(text(row))) continue;

      const path = new URL(row.href).pathname;
      if (!seen.has(path)) {
        return {
          button, row, path,
          name: (row.innerText || "").split("\n")[0].trim()
        };
      }
    }
  }

  async function leaveGroup(original) {
    // Retry the same canonical path, not the next unprocessed community.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const dialog = guard(true);
        const button = [...document.querySelectorAll(
          '[data-testid="desktop_group_item_button"]'
        )].find(el => {
          const row = el.closest("a[href]");
          return row && new URL(row.href).pathname === original.path;
        });
        const row = button?.closest("a[href]");

        if (!row) throw Error("Строка группы исчезла. Проверьте результат вручную.");

        const checkRow = () => {
          // VK can replace the row and button after a successful unsubscribe.
          const rows = [...new Set([...document.querySelectorAll(
            '[data-testid="desktop_group_item_button"]'
          )].map(el => el.closest("a[href]")).filter(el =>
            el?.isConnected && new URL(el.href).pathname === original.path
          ))];
          if (rows.length > 1) {
            throw Error("Найдено несколько строк одной группы. Проверьте вручную.");
          }
          return rows.length === 1 && isLeft(rows[0]);
        };

        const assertTarget = () => {
          if (!row.isConnected || button.closest("a[href]") !== row ||
              new URL(row.href).pathname !== original.path) {
            throw Error("Строка группы изменилась. Проверьте результат вручную.");
          }
        };

        if (dialog) {
          checkRow();
          await waitFor(checkRow, true);
          return;
        }

        // The first request may have succeeded during the retry pause.
        if (checkRow()) return;

        button.scrollIntoView({ block: "center" });
        button.dispatchEvent(new MouseEvent("mouseout", {
          bubbles: true,
          relatedTarget: document.body
        }));
        button.dispatchEvent(new MouseEvent("mouseover", {
          bubbles: true,
          relatedTarget: document.body
        }));

        const action = await waitFor(() => {
          if (checkRow()) return true;
          const expanded = [...document.querySelectorAll(
            '[data-testid="desktop_group_item_button"][aria-expanded="true"]'
          )];
          if (expanded.length !== 1 || expanded[0] !== button) return;

          const items = [...document.querySelectorAll(
            '[data-testid="dropdownactionsheet-item"]'
          )].filter(el => visible(el) && text(el) === "Отписаться");
          return items.length === 1 ? items[0] : null;
        });

        guard();
        if (checkRow()) return;
        assertTarget();
        action.click();
        await waitFor(checkRow, true);
        return;
      } catch (error) {
        // Security checks, unknown errors and manual cancellation are never retried.
        if (!(error instanceof RetryableError)) throw error;
        guard(true);
        if (attempt === 1) {
          throw Error(`${error.message} Повторная попытка не помогла — остановка.`);
        }

        console.log(`Повтор через 3 секунды: ${original.name}`);
        for (let tick = 0; tick < 20; tick++) {
          guard(true);
          await sleep(150);
        }
        guard(true);
      }
    }
  }

  try {
    guard();

    if (!confirm(
      "Отписаться от всех сообществ, включая закрытые?\n\n" +
      "Предупреждения о выходе будут подтверждаться автоматически. " +
      "Вернуться в закрытые группы может быть невозможно."
    )) return;

    while (true) {
      guard();
      let group = nextGroup();

      if (!group) {
        for (let attempt = 0; attempt < 8 && !group; attempt++) {
          guard();
          window.scrollTo(0, document.documentElement.scrollHeight);
          await sleep(1200);
          group = nextGroup();
        }

        if (!group) {
          console.log("Новых групп не найдено. Проверьте остаток после обновления.");
          break;
        }
      }

      seen.add(group.path);
      await leaveGroup(group);

      console.log(`${++done}. Отписка: ${group.name}`);
      await sleep(700);
    }
  } catch (error) {
    console.warn("Остановка:", error.message);
  } finally {
    delete window.vkLeaveAll;
    console.log(
      `Интерфейс подтвердил отписок за этот запуск: ${done}. ` +
      "Обновите страницу для проверки."
    );
  }
})();
